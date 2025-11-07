import { apiClient } from './api';
import { initCrypto, sodium } from '../crypto';
import { x3dhInitiate, x3dhRespond } from '../crypto/x3dh';
import {
  initializeRatchetAlice,
  initializeRatchetBob,
  ratchetEncrypt,
  ratchetDecrypt,
  serializeRatchetState,
  deserializeRatchetState,
  RatchetState,
  RatchetHeader,
} from '../crypto/ratchet';
import { EncryptedEnvelope } from '../crypto/aead';
import { cleanInvalidSessions, getSessionStats } from '../utils/sessionValidation';

/**
 * Messaging service that handles E2E encrypted message sending and receiving
 * Integrates X3DH for session establishment and Double Ratchet for forward secrecy
 */

export interface ConversationSession {
  conversationId: string;
  partnerId: string;
  partnerUsername: string;
  ratchetState: RatchetState;
  createdAt: Date;
  lastUsedAt: Date;
  // For Alice (initiator): store ephemeral key for first message
  x3dhEphemeralKey?: Uint8Array;
  // For Bob (responder): this will be undefined
  isInitiator?: boolean;
}

class MessagingService {
  private sessions: Map<string, ConversationSession> = new Map();

  async initialize(_userId: string): Promise<void> {
    await initCrypto();
    
    // Check storage version and clear if mismatched
    this.checkStorageVersion();
    
    // Validate sessions against backend
    await this.validateAndCleanSessions();
    
    this.loadSessionsFromStorage();
  }

  /**
   * Check storage version and clear if mismatched
   * This prevents issues when storage format changes
   */
  private checkStorageVersion(): void {
    const CURRENT_VERSION = '1.0.0';
    const storedVersion = localStorage.getItem('cipherlink_storage_version');
    
    if (!storedVersion || storedVersion !== CURRENT_VERSION) {
      console.warn(`🔄 Storage version mismatch (stored: ${storedVersion}, current: ${CURRENT_VERSION})`);
      console.log('🧹 Clearing all sessions to prevent compatibility issues...');
      
      // Clear all session data
      const keys = Object.keys(localStorage);
      keys.filter(k => k.startsWith('session_')).forEach(k => localStorage.removeItem(k));
      
      // Set new version
      localStorage.setItem('cipherlink_storage_version', CURRENT_VERSION);
      console.log('✅ Storage version updated');
    }
  }

  /**
   * Validate sessions against backend conversations
   * Clear sessions for conversations that no longer exist
   */
  private async validateAndCleanSessions(): Promise<void> {
    try {
      console.log('🔍 Validating sessions against backend...');
      
      // Get all sessions from localStorage
      const sessionKeys = Object.keys(localStorage).filter(k => k.startsWith('session_'));
      if (sessionKeys.length === 0) {
        console.log('✅ No sessions to validate');
        return;
      }

      // Clean structurally invalid sessions first
      const stats = getSessionStats();
      if (stats.invalid > 0) {
        console.log(`🗑️ Removing ${stats.invalid} structurally invalid session(s)`);
        cleanInvalidSessions();
      }

      // Fetch all conversations from backend
      const { conversations } = await apiClient.getConversations();
      const validConvIds = new Set(conversations.map(c => c.convId));
      
      console.log(`📊 Backend has ${validConvIds.size} conversations, localStorage has ${sessionKeys.length} sessions`);

      // Check each session
      const updatedSessionKeys = Object.keys(localStorage).filter(k => k.startsWith('session_'));
      let removedCount = 0;
      
      for (const key of updatedSessionKeys) {
        const convId = key.replace('session_', '');
        
        // If conversation doesn't exist on backend, remove the session
        if (!validConvIds.has(convId)) {
          console.log(`🗑️ Removing orphaned session: ${convId}`);
          localStorage.removeItem(key);
          removedCount++;
        }
      }

      if (removedCount > 0) {
        console.log(`✅ Cleaned ${removedCount} orphaned session(s)`);
      } else {
        console.log('✅ All sessions match backend conversations');
      }
    } catch (err) {
      console.error('⚠️ Failed to validate sessions:', err);
      // Don't throw - allow app to continue with existing sessions
    }
  }

  /**
   * Start a new conversation with a user
   * Performs X3DH handshake and initializes Double Ratchet
   * Creates Conversation document on server per spec
   */
  async startConversation(
    partnerUserId: string,
    partnerUsername: string
  ): Promise<string> {
    try {


      // Get our identity keys (stored as hex)
      const identityPrivateKey = localStorage.getItem('identityPrivateKey');
      const identityPublicKey = localStorage.getItem('identityPublicKey');
      const userId = localStorage.getItem('userId');
      const deviceId = localStorage.getItem('deviceId');

      if (!identityPrivateKey || !identityPublicKey || !userId || !deviceId) {
        throw new Error('Identity keys not found. Please sign in again.');
      }

      const ourIdentityKeyPair = {
        publicKey: sodium.from_hex(identityPublicKey), // Keys are stored as hex
        privateKey: sodium.from_hex(identityPrivateKey), // Keys are stored as hex
      };

      // Fetch partner's devices to get their deviceId
      const partnerDevices = await apiClient.getDevices(partnerUserId);

      
      if (!partnerDevices || partnerDevices.length === 0) {
        throw new Error('Partner has no registered devices');
      }

      // Use the first device (in a full app, user would choose which device)
      const partnerDeviceId = partnerDevices[0].id;


      // Fetch prekey bundle from partner's device
      const bundle = await apiClient.getPreKeyBundle(partnerUserId, partnerDeviceId);


      // Parse the bundle (identityKey is hex, others are base64)
      const parsedBundle = {
        identityKey: sodium.from_hex(bundle.identityKey), // Identity key is stored as hex
        signedPreKey: sodium.from_base64(bundle.signedPreKey),
        signedPreKeySignature: sodium.from_base64(bundle.signedPreKeySignature),
        oneTimePreKey: bundle.oneTimePreKey
          ? sodium.from_base64(bundle.oneTimePreKey)
          : undefined,
      };


      // Perform X3DH handshake
      const x3dhResult = x3dhInitiate(ourIdentityKeyPair, parsedBundle);

      // Initialize Double Ratchet with shared secret from X3DH
      // Use partner's signedPreKey as their initial ratchet public key
      const ratchetState = initializeRatchetAlice(
        x3dhResult.sharedSecret,
        parsedBundle.signedPreKey
      );

      // Generate conversation ID (UUID per spec)
      const convId = crypto.randomUUID();

      // Create Conversation document on server per spec
      await apiClient.createConversation({
        convId,
        type: 'one_to_one',
        memberUserIds: [userId, partnerUserId],
      });

      // Create session
      const session: ConversationSession = {
        conversationId: convId,
        partnerId: partnerUserId,
        partnerUsername,
        ratchetState,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        x3dhEphemeralKey: x3dhResult.ephemeralPublicKey, // Store for first message
        isInitiator: true, // Alice is the initiator
      };

      // Store session
      this.sessions.set(convId, session);
      this.saveSessionToStorage(session);


      return convId;
    } catch (error) {

      if (error instanceof Error) {


      }
      throw error;
    }
  }

  /**
   * Send a conversation request without creating a session
   * Session will be created after the recipient accepts
   */
  async sendConversationRequest(
    partnerUserId: string,
    _partnerUsername: string
  ): Promise<string> {
    try {
      const userId = localStorage.getItem('userId');
      if (!userId) {
        throw new Error('User ID not found. Please sign in again.');
      }

      // Generate conversation ID
      const convId = crypto.randomUUID();

      // Create conversation on backend (status will be 'pending')
      await apiClient.createConversation({
        convId,
        type: 'one_to_one',
        memberUserIds: [userId, partnerUserId],
      });

      return convId;
    } catch (error) {

      throw error;
    }
  }

  /**
   * Initialize session for Alice after Bob accepts
   * Alice will perform X3DH and include ephemeral key in first message
   */
  async initializeSessionAfterAccept(
    conversationId: string,
    partnerUserId: string,
    partnerUsername: string
  ): Promise<void> {
    try {


      // Check if session already exists
      if (this.sessions.has(conversationId)) {

        return;
      }

      // Get our identity keys
      const identityPrivateKey = localStorage.getItem('identityPrivateKey');
      const identityPublicKey = localStorage.getItem('identityPublicKey');

      if (!identityPrivateKey || !identityPublicKey) {
        throw new Error('Keys not found. Please sign in again.');
      }

      const ourIdentityKeyPair = {
        publicKey: sodium.from_hex(identityPublicKey),
        privateKey: sodium.from_hex(identityPrivateKey),
      };

      // Fetch partner's devices and prekey bundle

      const partnerDevices = await apiClient.getDevices(partnerUserId);


      
      if (!partnerDevices || partnerDevices.length === 0) {

        throw new Error('Partner has no registered devices');
      }

      const partnerDeviceId = partnerDevices[0].id;

      const bundle = await apiClient.getPreKeyBundle(partnerUserId, partnerDeviceId);

      const parsedBundle = {
        identityKey: sodium.from_hex(bundle.identityKey),
        signedPreKey: sodium.from_base64(bundle.signedPreKey),
        signedPreKeySignature: sodium.from_base64(bundle.signedPreKeySignature),
        oneTimePreKey: bundle.oneTimePreKey
          ? sodium.from_base64(bundle.oneTimePreKey)
          : undefined,
      };

      // Perform X3DH handshake
      const x3dhResult = x3dhInitiate(ourIdentityKeyPair, parsedBundle);

      // Initialize Double Ratchet
      const ratchetState = initializeRatchetAlice(
        x3dhResult.sharedSecret,
        parsedBundle.signedPreKey
      );

      // Create session
      const session: ConversationSession = {
        conversationId,
        partnerId: partnerUserId,
        partnerUsername,
        ratchetState,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        x3dhEphemeralKey: x3dhResult.ephemeralPublicKey, // Will be included in first message
        isInitiator: true,
      };

      // Store session
      this.sessions.set(conversationId, session);
      this.saveSessionToStorage(session);

    } catch (error) {

      throw error;
    }
  }

  /**
   * Encrypt and send a message using new Message schema per spec
   */
  async sendMessage(
    conversationId: string,
    plaintext: string
  ): Promise<{
    messageId: string;
    ciphertext: string;
    header: RatchetHeader;
  }> {
    const session = this.sessions.get(conversationId);
    if (!session) {
      throw new Error('Session not found for conversation');
    }

    // Validate ratchet state before attempting encryption
    if (!session.ratchetState.rootKey || !session.ratchetState.sendingChainKey) {



      throw new Error('Invalid ratchet state - please clear browser storage and try again');
    }

    const userId = localStorage.getItem('userId');
    const deviceId = localStorage.getItem('deviceId');


    if (!userId || !deviceId) {


      throw new Error('User not authenticated');
    }

    // Encrypt using Double Ratchet
    const { envelope, header } = ratchetEncrypt(session.ratchetState, plaintext);

    // If this is the first message from initiator, include X3DH ephemeral key
    const enhancedHeader = { ...header };
    if (session.isInitiator && session.x3dhEphemeralKey) {
      const identityPublicKey = localStorage.getItem('identityPublicKey');
      enhancedHeader.ephemeralKey = sodium.to_base64(session.x3dhEphemeralKey);
      enhancedHeader.senderIdentityKey = identityPublicKey || undefined; // Already hex format

      // Clear it after first use
      delete session.x3dhEphemeralKey;
      delete session.isInitiator;
    }

    // Update session
    session.lastUsedAt = new Date();
    this.saveSessionToStorage(session);

    // Get conversation details to get memberDeviceIds
    let conversation;
    try {
      conversation = await apiClient.getConversation(conversationId);
    } catch (error: any) {
      if (error.response?.status === 404) {


        this.deleteSession(conversationId);
        throw new Error('Conversation not found. Please start a new conversation.');
      }
      throw error;
    }

    // Generate message ID (UUID per spec)
    const messageId = crypto.randomUUID();
    const sentAt = new Date();

    // Prepare AAD per spec
    const aad = {
      senderId: userId,
      recipientIds: conversation.memberUserIds.filter((id) => id !== userId),
      ts: sentAt.toISOString(),
    };

    // Package ciphertext with header (JSON format expected by receiveMessage)
    const ciphertextWithHeader = JSON.stringify({
      envelope: {
        nonce: envelope.nonce,        // Already base64 from encryptAEAD
        ciphertext: envelope.ciphertext, // Already base64 from encryptAEAD
      },
      header: {
        dhPublicKey: enhancedHeader.dhPublicKey, // Already base64 encoded
        messageNumber: enhancedHeader.messageNumber,
        previousChainLength: enhancedHeader.previousChainLength,
        ephemeralKey: enhancedHeader.ephemeralKey, // Include if present
        senderIdentityKey: enhancedHeader.senderIdentityKey, // Include if present
      },
    });

    // Prepare message data per spec
    const messageData = {
      messageId,
      convId: conversationId,
      toDeviceIds: conversation.memberDeviceIds.filter((id) => id !== deviceId), // Exclude our own device
      aad: {
        senderId: aad.senderId,
        recipientIds: aad.recipientIds,
        ts: aad.ts,
      },
      nonce: envelope.nonce,  // Already base64 from encryptAEAD
      ciphertext: ciphertextWithHeader, // Now includes both envelope and header
      messageNumber: enhancedHeader.messageNumber, // Include for ratchet ordering
      sentAt: sentAt.toISOString(),
    };

    // Send to server
    console.log('📤 Sending message to server:', {
      messageId,
      convId: conversationId,
      toDeviceIds: messageData.toDeviceIds,
      recipientCount: messageData.toDeviceIds.length
    });
    const response = await apiClient.sendMessage(messageData);
    console.log('✅ Message sent successfully:', response);

    return {
      messageId: response.messageId,
      ciphertext: messageData.ciphertext,
      header: enhancedHeader,
    };
  }

  /**
   * Decrypt a received message
   */
  async receiveMessage(data: {
    messageId: string;
    conversationId: string;
    senderId: string;
    ciphertext: string;
    timestamp: string;
  }): Promise<{
    messageId: string;
    plaintext: string;
    senderId: string;
    timestamp: Date;
  }> {
    console.log('📨 receiveMessage called:', {
      messageId: data.messageId,
      conversationId: data.conversationId,
      senderId: data.senderId,
      ciphertextLength: data.ciphertext.length
    });
    
    // Parse ciphertext envelope
    let envelope: EncryptedEnvelope;
    let header: RatchetHeader;

    try {
      const parsed = JSON.parse(data.ciphertext);
      console.log('📦 Parsed ciphertext envelope');
      
      // Envelope is already in base64 string format (matches EncryptedEnvelope interface)
      envelope = {
        nonce: parsed.envelope.nonce,
        ciphertext: parsed.envelope.ciphertext,
      };
      
      // Header may include ephemeral key for first message
      header = {
        dhPublicKey: parsed.header.dhPublicKey,
        messageNumber: parsed.header.messageNumber,
        previousChainLength: parsed.header.previousChainLength,
        ephemeralKey: parsed.header.ephemeralKey, // May be undefined
        senderIdentityKey: parsed.header.senderIdentityKey, // May be undefined
      };
      console.log('📋 Header:', { messageNumber: header.messageNumber, hasEphemeralKey: !!header.ephemeralKey });

    } catch (err) {
      console.error('❌ Failed to parse ciphertext:', err);
      throw new Error('Invalid ciphertext format');
    }

    // Get or create session
    let session = this.sessions.get(data.conversationId);
    console.log('🔍 Session lookup:', { 
      conversationId: data.conversationId, 
      sessionExists: !!session 
    });

    if (!session) {
      console.log('🆕 No session found - initializing as Bob (receiver)');
      // This is the first message from partner (we're Bob)
      
      // Check if this is a first message with X3DH data
      if (!header.ephemeralKey || !header.senderIdentityKey) {
        console.error('❌ Missing X3DH data in first message');
        throw new Error('First message must include X3DH ephemeral key and sender identity');
      }
      
      session = await this.initializeSessionAsBob(
        data.conversationId,
        data.senderId,
        header.ephemeralKey,
        header.senderIdentityKey
      );
      console.log('✅ Session initialized as Bob');
    }

    // Decrypt using Double Ratchet
    console.log('🔓 Decrypting with Double Ratchet...');
    
    try {
      const plaintextBytes = ratchetDecrypt(session.ratchetState, envelope, header);
      const plaintext = sodium.to_string(plaintextBytes);
      console.log('✅ Message decrypted successfully:', plaintext.substring(0, 50) + '...');

      // Update session
      session.lastUsedAt = new Date();
      this.saveSessionToStorage(session);
      console.log('💾 Session updated and saved');

      return {
        messageId: data.messageId,
        plaintext,
        senderId: data.senderId,
        timestamp: new Date(data.timestamp),
      };
    } catch (decryptErr) {
      console.error('❌ Ratchet decryption failed:', decryptErr);
      
      // If decryption fails, the ratchet state is out of sync
      // This usually means the session is corrupted
      console.warn('⚠️ Ratchet state mismatch detected - removing corrupted session');
      this.deleteSession(data.conversationId);
      
      throw new Error('Ratchet state mismatch - session has been reset. Please ask your contact to send the message again.');
    }
  }

  /**
   * Initialize session as Bob (receiver) when receiving first message
   */
  private async initializeSessionAsBob(
    conversationId: string,
    partnerId: string,
    theirEphemeralKeyBase64: string,
    theirIdentityKeyHex: string
  ): Promise<ConversationSession> {

    
    // Get our identity keys
    const identityPrivateKey = localStorage.getItem('identityPrivateKey');
    const identityPublicKey = localStorage.getItem('identityPublicKey');
    const signedPreKeyPrivate = localStorage.getItem('signedPreKeyPrivate');
    const signedPreKeyPublic = localStorage.getItem('signedPreKeyPublic');

    if (!identityPrivateKey || !identityPublicKey || !signedPreKeyPrivate || !signedPreKeyPublic) {
      throw new Error('Keys not found. Please sign in again.');
    }

    // Parse our keys (stored as hex/base64)
    const ourIdentityKeyPair = {
      publicKey: sodium.from_hex(identityPublicKey),
      privateKey: sodium.from_hex(identityPrivateKey),
    };
    
    const ourSignedPreKeyPair = {
      publicKey: sodium.from_base64(signedPreKeyPublic),
      privateKey: sodium.from_base64(signedPreKeyPrivate),
    };
    
    // Parse their keys
    const theirIdentityKey = sodium.from_hex(theirIdentityKeyHex);
    const theirEphemeralKey = sodium.from_base64(theirEphemeralKeyBase64);

    // Perform X3DH response to get same shared secret as Alice
    const sharedSecret = x3dhRespond(
      ourIdentityKeyPair,
      ourSignedPreKeyPair,
      theirIdentityKey,
      theirEphemeralKey
    );


    // Initialize Double Ratchet as Bob (receiver)
    // Use our signedPreKey as our initial ratchet key (Alice will use this same key)
    const ratchetState = initializeRatchetBob(sharedSecret, ourSignedPreKeyPair);

    // Fetch partner username
    let partnerUsername = 'Unknown';
    try {
      const user = await apiClient.getUserById(partnerId);
      partnerUsername = user.username;
    } catch (err) {
      console.warn('Failed to fetch partner username:', err);
      // Fallback to userId
      partnerUsername = partnerId;
    }

    const session: ConversationSession = {
      conversationId,
      partnerId,
      partnerUsername,
      ratchetState,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      isInitiator: false, // Bob is not the initiator
    };

    this.sessions.set(conversationId, session);
    this.saveSessionToStorage(session);


    return session;
  }

  /**
   * Get session for a conversation
   */
  getSession(conversationId: string): ConversationSession | undefined {
    return this.sessions.get(conversationId);
  }

  /**
   * Save session to localStorage
   */
  private saveSessionToStorage(session: ConversationSession): void {
    const serialized = {
      conversationId: session.conversationId,
      partnerId: session.partnerId,
      partnerUsername: session.partnerUsername,
      ratchetState: serializeRatchetState(session.ratchetState),
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
      x3dhEphemeralKey: session.x3dhEphemeralKey 
        ? sodium.to_base64(session.x3dhEphemeralKey) 
        : undefined,
      isInitiator: session.isInitiator,
    };

    localStorage.setItem(`session_${session.conversationId}`, JSON.stringify(serialized));
  }

  /**
   * Load all sessions from localStorage
   */
  private loadSessionsFromStorage(): void {
    const keys = Object.keys(localStorage);
    const sessionKeys = keys.filter((k) => k.startsWith('session_'));

    for (const key of sessionKeys) {
      try {
        const serialized = localStorage.getItem(key);
        if (!serialized) continue;

        const data = JSON.parse(serialized);
        
        // Skip old sessions with non-UUID convIds (before architecture fix)
        if (!data.conversationId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {

          localStorage.removeItem(key);
          continue;
        }
        
        const ratchetState = deserializeRatchetState(data.ratchetState);
        
        // Validate ratchet state has required keys (prevent corrupted sessions)
        if (!ratchetState.rootKey) {

          localStorage.removeItem(key);
          continue;
        }
        
        const session: ConversationSession = {
          conversationId: data.conversationId,
          partnerId: data.partnerId,
          partnerUsername: data.partnerUsername,
          ratchetState,
          createdAt: new Date(data.createdAt),
          lastUsedAt: new Date(data.lastUsedAt),
          x3dhEphemeralKey: data.x3dhEphemeralKey 
            ? sodium.from_base64(data.x3dhEphemeralKey) 
            : undefined,
          isInitiator: data.isInitiator,
        };

        this.sessions.set(session.conversationId, session);
      } catch (err) {

      }
    }

  }

  /**
   * Delete a conversation session
   */
  deleteSession(conversationId: string): void {
    this.sessions.delete(conversationId);
    localStorage.removeItem(`session_${conversationId}`);
  }

  /**
   * Check if a session exists for a conversation
   */
  hasSession(conversationId: string): boolean {
    return this.sessions.has(conversationId);
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): ConversationSession[] {
    return Array.from(this.sessions.values());
  }
}

export const messagingService = new MessagingService();

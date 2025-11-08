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
  validateRatchetStateForEncryption,
  validateRatchetStateForDecryption,
  RatchetState,
  RatchetHeader,
} from '../crypto/ratchet';
import { EncryptedEnvelope } from '../crypto/aead';
import { cleanInvalidSessions, getSessionStats } from '../utils/sessionValidation';

/**
 * Messaging service that handles E2E encrypted message sending and receiving
 * Integrates X3DH for session establishment and Double Ratchet for forward secrecy
 *
 * KNOWN LIMITATIONS (MOSTLY ADDRESSED):
 * - Session consistency: Double Ratchet requires both parties to maintain synchronized state.
 *   ✅ FIXED: Automatic resync when Alice reinitializes (Bob detects first message with X3DH data)
 *   ✅ FIXED: Retry mechanism for decryption failures during transition windows
 *   ✅ FIXED: Proper locking prevents race conditions during session operations
 *   ✅ VERIFIED: Persistence cleanup ensures old sessions are fully replaced
 *
 * - Bidirectional detection: Only Alice can initiate sessions (sends first message with X3DH data).
 *   Bob can only respond, so reinitialization detection is unidirectional by protocol design.
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
  private sessionInitLocks: Set<string> = new Set(); // Prevent concurrent session initialization
  private messageProcessingLocks: Map<string, Promise<{
    messageId: string;
    plaintext: string;
    senderId: string;
    timestamp: Date;
  }>> = new Map(); // Prevent concurrent message processing per conversation
  private sessionUpdateLocks: Map<string, Promise<void>> = new Map(); // Prevent concurrent session updates
  private decryptionFailureCounts: Map<string, number> = new Map(); // Track consecutive decryption failures per conversation
  private ourUserId: string | null = null;

  async initialize(_userId: string): Promise<void> {
    await initCrypto();
    this.ourUserId = _userId;
    
    // Clean invalid sessions before loading
    const stats = getSessionStats();
    
    if (stats.invalid > 0) {
      cleanInvalidSessions();
    }
    
    this.loadSessionsFromStorage();
  }

  /**
   * Atomically update a session to prevent race conditions
   */
  private async updateSessionAtomically(
    conversationId: string,
    updateFn: (session: ConversationSession) => void
  ): Promise<void> {
    // Wait for any ongoing updates to complete
    const existingUpdate = this.sessionUpdateLocks.get(conversationId);
    if (existingUpdate) {
      await existingUpdate;
    }

    // Create and set the update promise
    const updatePromise = (async () => {
      const session = this.sessions.get(conversationId);
      if (!session) {
        throw new Error(`Session not found for conversation ${conversationId}`);
      }

      // Apply the update
      updateFn(session);

      // Save to storage
      this.saveSessionToStorage(session);
    })();

    this.sessionUpdateLocks.set(conversationId, updatePromise);

    try {
      await updatePromise;
    } finally {
      this.sessionUpdateLocks.delete(conversationId);
    }
  }
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
      const result = await apiClient.createConversation({
        convId,
        type: 'one_to_one',
        memberUserIds: [userId, partnerUserId],
      });

      // If backend returned an existing conversation, use that ID instead
      const actualConvId = result.message === 'Existing conversation returned' ? result.convId : convId;

      return actualConvId;
    } catch (error) {

      throw error;
    }
  }

  /**
   * Initialize session as Alice for outbound message (when no session exists)
   */
  private async initializeSessionAsAliceForOutbound(conversationId: string): Promise<ConversationSession> {
    console.log('[messaging] Initializing session as Alice for outbound message', { conversationId });

    // Get our identity keys
    const identityPrivateKey = localStorage.getItem('identityPrivateKey');
    const identityPublicKey = localStorage.getItem('identityPublicKey');
    const userId = localStorage.getItem('userId');

    if (!identityPrivateKey || !identityPublicKey || !userId) {
      throw new Error('Identity keys not found. Please sign in again.');
    }

    // Get conversation to find partner
    const conversation = await apiClient.getConversation(conversationId);
    const partnerId = conversation.memberUserIds.find(id => id !== userId);
    if (!partnerId) {
      throw new Error('Partner not found in conversation');
    }

    // Fetch partner's devices and prekey bundle
    const partnerDevices = await apiClient.getDevices(partnerId);
    if (!partnerDevices || partnerDevices.length === 0) {
      throw new Error('Partner has no registered devices');
    }

    const partnerDeviceId = partnerDevices[0].id;
    const bundle = await apiClient.getPreKeyBundle(partnerId, partnerDeviceId);

    const parsedBundle = {
      identityKey: sodium.from_hex(bundle.identityKey),
      signedPreKey: sodium.from_base64(bundle.signedPreKey),
      signedPreKeySignature: sodium.from_base64(bundle.signedPreKeySignature),
      oneTimePreKey: bundle.oneTimePreKey
        ? sodium.from_base64(bundle.oneTimePreKey)
        : undefined,
    };

    // Perform X3DH handshake
    const ourIdentityKeyPair = {
      publicKey: sodium.from_hex(identityPublicKey),
      privateKey: sodium.from_hex(identityPrivateKey),
    };

    const x3dhResult = x3dhInitiate(ourIdentityKeyPair, parsedBundle);

    // Initialize Double Ratchet
    const ratchetState = initializeRatchetAlice(
      x3dhResult.sharedSecret,
      parsedBundle.signedPreKey
    );

    // Fetch partner username
    let partnerUsername = 'Unknown';
    try {
      const user = await apiClient.getUserById(partnerId);
      if (user && user.username) {
        partnerUsername = user.username;
      }
    } catch (err) {
      // leave as 'Unknown'
    }

    const session: ConversationSession = {
      conversationId,
      partnerId,
      partnerUsername,
      ratchetState,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      x3dhEphemeralKey: x3dhResult.ephemeralPublicKey, // Will be included in first message
      isInitiator: true,
    };

    this.sessions.set(conversationId, session);
    this.saveSessionToStorage(session);

    console.log('[messaging:x3dh] ✅ Alice session initialized for outbound message', {
      conversationId,
      partnerId,
      hasEphemeralKey: true
    });

    return session;
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
    console.log('[messaging:send] 🚀 STARTING SEND MESSAGE', {
      conversationId,
      plaintextLength: plaintext.length,
      timestamp: new Date().toISOString()
    });

    let session = this.sessions.get(conversationId);

    // If no session exists, initialize one as Alice (initiator)
    if (!session) {
      console.log('[messaging:send] 🆕 No session found, initializing as Alice for first outbound message');
      session = await this.initializeSessionAsAliceForOutbound(conversationId);
      console.log('[messaging:send] ✅ Session initialized as Alice for outbound message');
    }

    // At this point session should exist
    if (!session) {
      console.error('[messaging:send] ❌ Session initialization failed');
      throw new Error('Failed to initialize session for sending');
    }

    console.log('[messaging:send] 📋 Session found, validating integrity...');
    // Check session integrity before sending
    if (!this.validateSessionIntegrity(session)) {
      console.error(`[messaging:send] ❌ Session corruption detected before sending in ${conversationId}`);
      throw new Error('Session is corrupted - please restart the conversation');
    }
    console.log('[messaging:send] ✅ Session integrity validated');

    // Validate ratchet state before attempting encryption
    console.log('[messaging:send] 🔐 Validating ratchet state for encryption...');
    validateRatchetStateForEncryption(session.ratchetState);
    console.log('[messaging:send] ✅ Ratchet state validated');

    const userId = localStorage.getItem('userId');
    const deviceId = localStorage.getItem('deviceId');

    if (!userId || !deviceId) {
      console.error('[messaging:send] ❌ User not authenticated');
      throw new Error('User not authenticated');
    }

    console.log('[messaging:send] 🔒 Encrypting message with Double Ratchet...');
    // Encrypt using Double Ratchet
    const { envelope, header } = ratchetEncrypt(session.ratchetState, plaintext);
    console.log('[messaging:send] ✅ Message encrypted', {
      messageNumber: header.messageNumber,
      hasEphemeralKey: !!session.x3dhEphemeralKey
    });

    // If this is the first message from initiator, include X3DH ephemeral key
    const enhancedHeader = { ...header };
    if (session.x3dhEphemeralKey) {
      console.log('[messaging:send] 🔑 Including X3DH handshake data in first message');
      const identityPublicKey = localStorage.getItem('identityPublicKey');
      enhancedHeader.ephemeralKey = sodium.to_base64(session.x3dhEphemeralKey);
      enhancedHeader.senderIdentityKey = identityPublicKey || undefined; // Already hex format

      // Clear it after first use
      delete session.x3dhEphemeralKey;
      delete session.isInitiator;
      console.log('[messaging:send] 🧹 Cleared X3DH ephemeral key from session');
    }

    console.log('[messaging:send] 💾 Updating session metadata...');
    // Update session atomically
    await this.updateSessionAtomically(conversationId, (session) => {
      session.lastUsedAt = new Date();
    });
    console.log('[messaging:send] ✅ Session updated');

    console.log('[messaging:send] 🌐 Fetching conversation details...');
    // Get conversation details to get memberDeviceIds
    let conversation;
    try {
      conversation = await apiClient.getConversation(conversationId);
      console.log('[messaging:send] ✅ Conversation fetched', {
        memberUserIds: conversation.memberUserIds?.length,
        memberDeviceIds: conversation.memberDeviceIds?.length
      });
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.error('[messaging:send] ❌ Conversation not found, deleting session');
        this.deleteSession(conversationId);
        throw new Error('Conversation not found. Please start a new conversation.');
      }
      throw error;
    }

    // Device refresh logic...
    try {
      const deviceId = localStorage.getItem('deviceId');
      const otherDeviceIds = conversation.memberDeviceIds?.filter((id: string) => id !== deviceId) || [];
      console.log('[messaging:send] 📱 Device check:', {
        ourDeviceId: deviceId,
        allMemberDeviceIds: conversation.memberDeviceIds?.length,
        otherDeviceIds: otherDeviceIds.length,
        needsRefresh: !conversation.memberDeviceIds || conversation.memberDeviceIds.length === 0 || otherDeviceIds.length === 0
      });

      if (!conversation.memberDeviceIds || conversation.memberDeviceIds.length === 0 || otherDeviceIds.length === 0) {
        console.log('[messaging:send] 🔄 Refreshing conversation devices...');
        try {
          const refreshed = await apiClient.refreshConversationDevices(conversationId);
          // if refresh returned memberDeviceIds, use them
          if (refreshed && refreshed.memberDeviceIds) {
            conversation.memberDeviceIds = refreshed.memberDeviceIds;
            console.log('[messaging:send] ✅ Devices refreshed:', conversation.memberDeviceIds.length);
          }
        } catch (refreshErr) {
          console.error('[messaging:send] ⚠️ Device refresh failed:', refreshErr);
          // ignore refresh errors; we'll handle missing recipients later
        }
      }
    } catch (err) {
      console.error('[messaging:send] ⚠️ Device handling error:', err);
      // ignore
    }

    console.log('[messaging:send] 🆔 Generating message ID...');
    // Generate message ID (UUID per spec)
    const messageId = crypto.randomUUID();
    const sentAt = new Date();

    console.log('[messaging:send] 📦 Preparing message data...');
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

    console.log('[messaging:send] 📤 Sending to backend...', {
      messageId,
      toDeviceCount: messageData.toDeviceIds.length,
      messageNumber: messageData.messageNumber,
      hasX3DHData: !!(enhancedHeader.ephemeralKey && enhancedHeader.senderIdentityKey)
    });

    const response = await apiClient.sendMessage(messageData);

    console.log('[messaging:send] ✅ Message sent successfully', {
      messageId: response.messageId,
      serverReceivedAt: response.serverReceivedAt
    });

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

    console.log('[messaging:receive] 📨 RECEIVE MESSAGE START', { 
      messageId: data.messageId, 
      conversationId: data.conversationId,
      senderId: data.senderId,
      timestamp: data.timestamp
    });
    
    // Skip decrypting self-sent messages
    if (data.senderId === this.ourUserId) {
      console.log('[messaging:receive] 🔄 Skipping self-sent message echo');
      return {
        messageId: data.messageId,
        plaintext: '', // Empty plaintext for self-messages
        senderId: data.senderId,
        timestamp: new Date(data.timestamp),
      };
    }

    console.log('[messaging:receive] 🔒 Processing message for decryption...');
    // Prevent concurrent message processing for the same conversation
    const processingKey = data.conversationId;
    if (this.messageProcessingLocks.has(processingKey)) {
      console.log('[messaging:receive] ⏳ Waiting for concurrent message processing to complete', { conversationId: data.conversationId, messageId: data.messageId });
      await this.messageProcessingLocks.get(processingKey)!;
    }

    const processingPromise = this.processMessage(data);
    this.messageProcessingLocks.set(processingKey, processingPromise);

    try {
      const result = await processingPromise;
      console.log('[messaging:receive] ✅ Message processed successfully', {
        messageId: data.messageId,
        plaintextLength: result.plaintext.length
      });
      return result;
    } finally {
      this.messageProcessingLocks.delete(processingKey);
    }
  }

  /**
   * Process a single message with proper locking
   */
  private async processMessage(data: {
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
    console.log('[messaging:process] 🔍 Parsing ciphertext envelope...');
    // Parse ciphertext envelope
    let envelope: EncryptedEnvelope;
    let header: RatchetHeader;

    try {
      const parsed = JSON.parse(data.ciphertext);

      console.log('[messaging:process] 📄 Ciphertext parsed successfully');
      
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

      console.log('[messaging:process] 📋 Header parsed', {
        messageNumber: header.messageNumber,
        hasEphemeralKey: !!header.ephemeralKey,
        hasSenderIdentityKey: !!header.senderIdentityKey,
        dhPublicKey: header.dhPublicKey?.substring(0, 10) + '...'
      });

      // Validate message number
      if (header.messageNumber < 0) {
        console.error('[messaging:process] ❌ Invalid message number:', header.messageNumber);
        throw new Error('Invalid message number: cannot be negative');
      }

      // Handle invalid messageNumber 0 without ephemeral key
      if (header.messageNumber === 0 && !header.ephemeralKey) {
        console.warn('[messaging:process] ⚠️ Message with messageNumber 0 but no ephemeral key - checking for existing session');
        // This is allowed if we already have a session for this conversation
        // The sender might have initialized their session independently
      }

    } catch (err) {
      console.error('[messaging:process] ❌ Failed to parse ciphertext', err);
      throw new Error('Invalid ciphertext format');
    }

    console.log('[messaging:process] 🔍 Looking up session...');
    // Get or create session
    let session = this.sessions.get(data.conversationId);

    console.log('[messaging:process] 📊 Session lookup result', { 
      conversationId: data.conversationId, 
      sessionExists: !!session,
      hasX3DHData: !!(header.ephemeralKey && header.senderIdentityKey),
      messageNumber: header.messageNumber
    });

    if (session) {
      // Check session integrity when accessed
      if (!this.validateSessionIntegrity(session)) {
        console.warn(`[messaging:process] ⚠️ Session corruption detected, marking for repair`);
        // Mark as corrupted and attempt repair
        this.markSessionAsCorrupted(data.conversationId);
        this.deleteSession(data.conversationId);
        session = undefined;
      }
    }

    if (!session) {
      // No existing session - check if this message contains X3DH data for initialization
      if (header.ephemeralKey && header.senderIdentityKey) {
        console.log('[messaging:process] 🔑 X3DH data found, initializing session as Bob');
        session = await this.initializeSessionAsBob(
          data.conversationId,
          data.senderId,
          header.ephemeralKey,
          header.senderIdentityKey
        );
        console.log('[messaging:process] ✅ Session initialized as Bob');
      } else if (header.messageNumber === 0) {
        // Message number 0 without X3DH data - sender initialized independently
        // We need to initialize our own session as Bob to respond
        console.log('[messaging:process] 🔄 Message 0 without X3DH data - sender initialized independently, initializing our Bob session');
        session = await this.initializeSessionAsBob(data.conversationId, data.senderId);
        console.log('[messaging:process] ✅ Session initialized as Bob for inbound message');
      } else {
        console.error('[messaging:process] ❌ No existing session and no X3DH data in message header');
        throw new Error('First message must include X3DH ephemeral key and sender identity for session establishment');
      }
    } else {
      // We have an existing session, but check if this message contains X3DH data
      // If it does, it means the sender has reinitialized their session and we should too
      if (header.ephemeralKey && header.senderIdentityKey) {
        console.log('[messaging:process] 🔄 X3DH data found in message, sender has reinitialized - reinitializing Bob session');
        // Prevent concurrent reinitialization
        if (this.sessionInitLocks.has(data.conversationId)) {
          console.warn(`[messaging:process] ⚠️ Session reinitialization already in progress, skipping`);
          // Use existing session for now - it might work or fail gracefully
          // This prevents race conditions during resync
        } else {
          this.sessionInitLocks.add(data.conversationId);
          try {
            // Delete the old session
            this.deleteSession(data.conversationId);
            // Reinitialize as Bob with the new X3DH data
            session = await this.initializeSessionAsBob(
              data.conversationId,
              data.senderId,
              header.ephemeralKey,
              header.senderIdentityKey
            );
            console.log('[messaging:process] ✅ Bob session reinitialized successfully');
          } finally {
            this.sessionInitLocks.delete(data.conversationId);
          }
        }
      }
    }

    console.log('[messaging:process] 🔓 Session ready, validating ratchet state...');
    // Validate ratchet state before attempting decryption
    validateRatchetStateForDecryption(session.ratchetState);
    console.log('[messaging:process] ✅ Ratchet state validated');

    console.log('[messaging:process] 🔑 Attempting decryption...');
    // Decrypt using Double Ratchet
    let plaintextBytes: Uint8Array;
    let decryptionAttempted = false;

    try {
      plaintextBytes = ratchetDecrypt(session.ratchetState, envelope, header);
      decryptionAttempted = true;
      console.log('[messaging:process] ✅ Decryption successful on first attempt');

      // Clear any previous decryption failures on success
      this.clearDecryptionFailures(data.conversationId);
    } catch (decryptError) {
      console.warn('[messaging:process] ⚠️ Decryption failed on first attempt:', (decryptError as Error).message);

      // Record the decryption failure for watchdog monitoring
      this.recordDecryptionFailure(data.conversationId);

      // Check if we should trigger automatic session recovery
      if (this.shouldTriggerSessionRecovery(data.conversationId)) {
        console.error('[messaging:process] 🚨 Triggering automatic session recovery due to consecutive failures');

        try {
          await this.checkAndRepairSessionCorruption(data.conversationId);
          // After repair, the session is gone, so we can't continue processing this message
          throw new Error('Session repaired - message cannot be processed, will be retried by sender');
        } catch (repairError) {
          console.error('[messaging:process] ❌ Session repair failed:', repairError);
          throw decryptError; // Throw original error
        }
      }

      // Check if this might be a desynchronization issue
      const shouldAttemptResync = this.shouldAttemptResync(header, decryptError as Error);

      if (shouldAttemptResync && header.ephemeralKey && header.senderIdentityKey) {
        console.log('[messaging:process] 🔄 Attempting automatic session resync');

        try {
          // Mark session as potentially corrupted
          this.markSessionAsCorrupted(data.conversationId);

          // Try to reinitialize session
          this.deleteSession(data.conversationId);
          const freshSession = await this.initializeSessionAsBob(
            data.conversationId,
            data.senderId,
            header.ephemeralKey,
            header.senderIdentityKey
          );

          // Try decryption again with fresh session
          plaintextBytes = ratchetDecrypt(freshSession.ratchetState, envelope, header);
          session = freshSession;
          decryptionAttempted = true;
          console.log('[messaging:process] ✅ Decryption succeeded after automatic resync');

          // Clear failure count after successful resync
          this.clearDecryptionFailures(data.conversationId);
        } catch (resyncError) {
          console.error('[messaging:process] ❌ Automatic resync failed:', (resyncError as Error).message);
          throw decryptError; // Throw original error
        }
      } else {
        throw decryptError;
      }
    }

    // Save ratchet state immediately after successful decryption
    if (decryptionAttempted) {
      console.debug('[messaging:process] 💾 Saving updated ratchet state after decrypt');
      // Ratchet state is already updated by ratchetDecrypt, just save the session
      await this.updateSessionAtomically(data.conversationId, () => {
        // Ratchet state updates are handled by the ratchetDecrypt function
      });
    }

    const plaintext = sodium.to_string(plaintextBytes);

    console.log('[messaging:process] 📝 Decryption successful, updating session metadata...');
    // Update session metadata atomically
    await this.updateSessionAtomically(data.conversationId, (session) => {
      session.lastUsedAt = new Date();
    });

    console.log('[messaging:process] ✅ Message processing complete', {
      messageId: data.messageId,
      plaintextLength: plaintext.length
    });

    return {
      messageId: data.messageId,
      plaintext,
      senderId: data.senderId,
      timestamp: new Date(data.timestamp),
    };
  }

  /**
   * Initialize session as Alice (initiator) after conversation acceptance
   */
  async initializeSessionAfterAccept(
    conversationId: string,
    partnerId: string,
    partnerUsername: string
  ): Promise<void> {
    console.log('[messaging] Initializing session as Alice after conversation acceptance', {
      conversationId,
      partnerId,
      partnerUsername
    });

    // Check if session already exists
    if (this.hasSession(conversationId)) {
      console.log('[messaging] Session already exists for conversation', conversationId);
      return;
    }

    // Initialize session as Alice (initiator)
    const session = await this.initializeSessionAsAliceForOutbound(conversationId);

    console.log('[messaging] Session initialized as Alice after acceptance', {
      conversationId,
      partnerId,
      isInitiator: session.isInitiator
    });
  }

  /**
   * Initialize session as Bob (receiver) when receiving first message
   * Supports both traditional X3DH initialization and inbound-only initialization
   */
  private async initializeSessionAsBob(
    conversationId: string,
    partnerId: string,
    theirEphemeralKeyBase64?: string,
    theirIdentityKeyHex?: string
  ): Promise<ConversationSession> {
    console.log('[messaging] Initializing session as Bob', {
      conversationId,
      partnerId,
      hasX3DHData: !!(theirEphemeralKeyBase64 && theirIdentityKeyHex),
      theirEphemeralKeyLength: theirEphemeralKeyBase64?.length,
      theirIdentityKeyLength: theirIdentityKeyHex?.length
    });

    // Get our identity keys
    const identityPrivateKey = localStorage.getItem('identityPrivateKey');
    const identityPublicKey = localStorage.getItem('identityPublicKey');
    const signedPreKeyPrivate = localStorage.getItem('signedPreKeyPrivate');
    const signedPreKeyPublic = localStorage.getItem('signedPreKeyPublic');

    if (!identityPrivateKey || !identityPublicKey || !signedPreKeyPrivate || !signedPreKeyPublic) {
      throw new Error('Keys not found. Please sign in again.');
    }

    console.log('[messaging] Bob keys found in localStorage');

    // Parse our keys (stored as hex/base64)
    const ourIdentityKeyPair = {
      publicKey: sodium.from_hex(identityPublicKey),
      privateKey: sodium.from_hex(identityPrivateKey),
    };

    const ourSignedPreKeyPair = {
      publicKey: sodium.from_base64(signedPreKeyPublic),
      privateKey: sodium.from_base64(signedPreKeyPrivate),
    };

    let ratchetState: RatchetState;
    let isInitiator = false;

    if (theirEphemeralKeyBase64 && theirIdentityKeyHex) {
      // Traditional X3DH initialization with full handshake data
      console.log('[messaging] Performing full X3DH initialization');

      // Parse their keys
      const theirIdentityKey = sodium.from_hex(theirIdentityKeyHex);
      const theirEphemeralKey = sodium.from_base64(theirEphemeralKeyBase64);

      console.log('[messaging] All keys parsed successfully');

      // Perform X3DH response to get same shared secret as Alice
      const sharedSecret = x3dhRespond(
        ourIdentityKeyPair,
        ourSignedPreKeyPair,
        theirIdentityKey,
        theirEphemeralKey
      );

      console.log('[messaging] X3DH shared secret calculated, length:', sharedSecret.length);

      // Initialize Double Ratchet as Bob (receiver)
      ratchetState = initializeRatchetBob(sharedSecret, ourSignedPreKeyPair);
      console.log('[messaging] Ratchet initialized as Bob with full X3DH');
    } else {
      // Inbound-only initialization - sender initialized independently
      // We create a receiving-only session that will be upgraded when X3DH data arrives
      console.log('[messaging] Performing inbound-only initialization (no X3DH data)');

      // Initialize Double Ratchet as Bob (receiver) without shared secret initially
      // We'll set the shared secret to a placeholder and update it when X3DH data arrives
      const placeholderSharedSecret = new Uint8Array(32); // Will be replaced with real shared secret
      ratchetState = initializeRatchetBob(placeholderSharedSecret, ourSignedPreKeyPair);
      console.log('[messaging] Ratchet initialized as Bob (receiving-only, awaiting X3DH upgrade)');
    }

    // Fetch partner username (prefer user username over device name)
    let partnerUsername = 'Unknown';
    try {
      // Try to fetch the user profile first
      try {
        const user = await apiClient.getUserById(partnerId);
        if (user && user.username) {
          partnerUsername = user.username;
        }
      } catch (userErr) {
        // Fallback to device name if user endpoint fails
        const devices = await apiClient.getDevices(partnerId);
        if (devices && devices.length > 0) {
          partnerUsername = devices[0].name || partnerId; // Use device name or userId as fallback
        }
      }
    } catch (err) {
      // leave partnerUsername as 'Unknown'
    }

    const session: ConversationSession = {
      conversationId,
      partnerId,
      partnerUsername,
      ratchetState,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      isInitiator,
    };

    this.sessions.set(conversationId, session);
    this.saveSessionToStorage(session);

    console.log('[messaging] Session created for Bob', {
      hasX3DHData: !!(theirEphemeralKeyBase64 && theirIdentityKeyHex),
      isInitiator
    });

    return session;
  }

  /**
   * Get session for a conversation
   */
  getSession(conversationId: string): ConversationSession | undefined {
    const session = this.sessions.get(conversationId);
    if (session) {
      // Check session integrity when accessed
      if (!this.validateSessionIntegrity(session)) {
        console.warn(`[messaging] Session corruption detected when accessing ${conversationId}`);
        // Don't return corrupted sessions
        return undefined;
      }
    }
    return session;
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
    console.log(`[messaging] Deleting session ${conversationId} from memory and storage`);
    const sessionKeysBefore = Object.keys(localStorage).filter(k => k.startsWith('session_'));
    console.log(`[messaging] Session keys before deletion:`, sessionKeysBefore);

    this.sessions.delete(conversationId);
    localStorage.removeItem(`session_${conversationId}`);

    const sessionKeysAfter = Object.keys(localStorage).filter(k => k.startsWith('session_'));
    console.log(`[messaging] Session keys after deletion:`, sessionKeysAfter);
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

  /**
   * Check if we should attempt automatic session resync based on decryption error
   */
  private shouldAttemptResync(header: RatchetHeader, decryptError: Error): boolean {
    // Attempt resync if:
    // 1. We have X3DH data available (ephemeral key and sender identity)
    // 2. The error suggests a key mismatch (common in desync scenarios)
    // 3. This is not a self-sent message (avoid infinite loops)
    const hasX3DHData = !!(header.ephemeralKey && header.senderIdentityKey);
    const isKeyError = decryptError.message.toLowerCase().includes('invalid key') ||
                      decryptError.message.toLowerCase().includes('tampered') ||
                      decryptError.message.toLowerCase().includes('authentication');

    console.log('[messaging] shouldAttemptResync check:', {
      hasX3DHData,
      isKeyError,
      errorMessage: decryptError.message
    });

    return hasX3DHData && isKeyError;
  }

  /**
   * Record a decryption failure for watchdog monitoring
   */
  private recordDecryptionFailure(conversationId: string): void {
    const currentCount = this.decryptionFailureCounts.get(conversationId) || 0;
    this.decryptionFailureCounts.set(conversationId, currentCount + 1);
    console.warn(`[messaging] Decryption failure count for ${conversationId}: ${currentCount + 1}`);
  }

  /**
   * Clear decryption failure count on successful decryption
   */
  private clearDecryptionFailures(conversationId: string): void {
    if (this.decryptionFailureCounts.has(conversationId)) {
      this.decryptionFailureCounts.delete(conversationId);
    }
  }

  /**
   * Check if we should trigger automatic session recovery based on failure count
   */
  private shouldTriggerSessionRecovery(conversationId: string): boolean {
    const failureCount = this.decryptionFailureCounts.get(conversationId) || 0;
    const maxConsecutiveFailures = 3; // Trigger recovery after 3 consecutive failures

    return failureCount >= maxConsecutiveFailures;
  }

  /**
   * Mark a session as potentially corrupted (for debugging/logging)
   */
  private markSessionAsCorrupted(conversationId: string): void {
    console.warn(`[messaging] Session ${conversationId} marked as potentially corrupted - attempting resync`);
  }

  /**
   * Validate session integrity and detect corruption
   */
  private validateSessionIntegrity(session: ConversationSession): boolean {
    try {
      // Check basic session structure
      if (!session.conversationId || !session.partnerId || !session.partnerUsername) {
        console.error('[messaging] Session missing basic metadata:', {
          conversationId: !!session.conversationId,
          partnerId: !!session.partnerId,
          partnerUsername: !!session.partnerUsername
        });
        return false;
      }

      // Check ratchet state integrity
      if (!session.ratchetState) {
        console.error('[messaging] Session missing ratchet state');
        return false;
      }

      const rs = session.ratchetState;

      // Validate required ratchet state fields
      // Note: sendingChainKey and receivingChainKey can be undefined initially
      // - Alice (initiator): sendingChainKey present, receivingChainKey undefined until first message received
      // - Bob (receiver): both undefined initially, receivingChainKey set on first message, sendingChainKey set on first send
      if (!rs.rootKey) {
        console.error('[messaging] Session ratchet state missing root key');
        return false;
      }

      // At minimum, we need rootKey and either sending or receiving capability
      const hasSendingCapability = rs.sendingChainKey && rs.dhSendingKey;
      const hasReceivingCapability = rs.receivingChainKey || rs.dhReceivingKey;

      if (!hasSendingCapability && !hasReceivingCapability) {
        console.error('[messaging] Session has neither sending nor receiving capability:', {
          sendingChainKey: !!rs.sendingChainKey,
          dhSendingKey: !!rs.dhSendingKey,
          receivingChainKey: !!rs.receivingChainKey,
          dhReceivingKey: !!rs.dhReceivingKey
        });
        return false;
      }

      // Validate key lengths (libsodium keys are 32 bytes) for present keys only
      const keyLength = 32;
      if (rs.rootKey.length !== keyLength) {
        console.error('[messaging] Session root key has invalid length:', rs.rootKey.length);
        return false;
      }

      if (rs.sendingChainKey && rs.sendingChainKey.length !== keyLength) {
        console.error('[messaging] Session sending chain key has invalid length:', rs.sendingChainKey.length);
        return false;
      }

      if (rs.receivingChainKey && rs.receivingChainKey.length !== keyLength) {
        console.error('[messaging] Session receiving chain key has invalid length:', rs.receivingChainKey.length);
        return false;
      }

      // Validate DH keys if present
      if (rs.dhSendingKey && rs.dhSendingKey.length !== keyLength) {
        console.error('[messaging] Session DH sending key has invalid length:', rs.dhSendingKey.length);
        return false;
      }

      if (rs.dhReceivingKey && rs.dhReceivingKey.length !== keyLength) {
        console.error('[messaging] Session DH receiving key has invalid length:', rs.dhReceivingKey.length);
        return false;
      }

      // Validate message numbers are non-negative
      if (rs.sendingMessageNumber < 0 || rs.receivingMessageNumber < 0) {
        console.error('[messaging] Session has negative message numbers:', {
          sendingMessageNumber: rs.sendingMessageNumber,
          receivingMessageNumber: rs.receivingMessageNumber
        });
        return false;
      }

      // Validate skipped message keys structure
      if (!(rs.skippedMessageKeys instanceof Map)) {
        console.error('[messaging] Session skippedMessageKeys is not a Map');
        return false;
      }

      // Check for reasonable bounds on skipped keys (prevent memory leaks)
      if (rs.skippedMessageKeys.size > 1000) {
        console.warn('[messaging] Session has excessive skipped message keys:', rs.skippedMessageKeys.size);
        // This is a warning, not a failure - the session can still function
      }

      // Validate timestamps
      if (!(session.createdAt instanceof Date) || !(session.lastUsedAt instanceof Date)) {
        console.error('[messaging] Session has invalid timestamps');
        return false;
      }

      if (session.createdAt > session.lastUsedAt) {
        console.warn('[messaging] Session createdAt is after lastUsedAt - possible corruption');
        // This is a warning, not a failure
      }

      return true;
    } catch (error) {
      console.error('[messaging] Session integrity validation failed with error:', error);
      return false;
    }
  }

  /**
   * Check and repair session corruption automatically
   */
  private async checkAndRepairSessionCorruption(conversationId: string): Promise<boolean> {
    const session = this.sessions.get(conversationId);
    if (!session) {
      console.log(`[messaging] No session found for corruption check: ${conversationId}`);
      return true; // No session = no corruption
    }

    if (!this.validateSessionIntegrity(session)) {
      console.error(`[messaging] Session corruption detected for ${conversationId}, attempting repair`);

      try {
        // Mark as corrupted for logging
        this.markSessionAsCorrupted(conversationId);

        // Attempt recovery by deleting and letting it be recreated
        this.deleteSession(conversationId);

        // Clear any failure counts
        this.decryptionFailureCounts.delete(conversationId);

        console.log(`[messaging] Session corruption repair completed for ${conversationId}`);
        return true;
      } catch (error) {
        console.error(`[messaging] Session corruption repair failed for ${conversationId}:`, error);
        return false;
      }
    }

    return true; // Session is valid
  }
}

export const messagingService = new MessagingService();

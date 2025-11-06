/**
 * Message envelope types for E2E encrypted messaging
 */

export interface MessageEnvelope {
  id: string;
  conversationId: string;
  senderId: string;
  senderDeviceId: string;
  recipientDeviceId?: string;
  ciphertext: string; // Base64 encrypted message
  messageType: 'text' | 'attachment' | 'system';
  attachmentId?: string;
  ratchetHeader: RatchetHeader;
  timestamp: Date;
}

export interface RatchetHeader {
  dhPublicKey: string; // Base64 encoded
  messageNumber: number;
  previousChainLength: number;
}

export interface DecryptedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  plaintext: string;
  messageType: 'text' | 'attachment' | 'system';
  attachmentId?: string;
  timestamp: Date;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  participants: User[];
  lastMessage?: DecryptedMessage;
  lastMessageAt: Date;
  unreadCount: number;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  identityPublicKey: string;
}

export interface Device {
  id: string;
  userId: string;
  deviceName: string;
  signedPreKey: string;
  signedPreKeySignature: string;
  lastSeenAt: Date;
}

export interface AttachmentMetadata {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

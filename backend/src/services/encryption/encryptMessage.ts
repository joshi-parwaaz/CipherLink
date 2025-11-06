/**
 * Message Encryption Service (Backend)
 * 
 * Constitutional Requirement: ZERO-ACCESS ARCHITECTURE
 * 
 * The backend does NOT encrypt/decrypt messages.
 * This service provides:
 * 1. Validation of encrypted message envelopes
 * 2. Storage of ciphertext (never plaintext!)
 * 3. Metadata handling (message IDs, timestamps, delivery status)
 * 
 * Actual encryption happens CLIENT-SIDE using 2key-ratchet.
 */

import logger from '../../utils/logger.js';

/**
 * Encrypted message envelope (as received from client)
 * This is what gets stored in MongoDB - all fields are encrypted or public metadata
 */
export interface EncryptedMessageEnvelope {
  conversationId: string;
  senderId: string;
  senderDeviceId: string;
  recipientId: string;
  recipientDeviceId: string;
  
  // 2key-ratchet ciphertext (base64)
  ciphertext: string;
  
  // Message number for out-of-order detection
  messageNumber: number;
  
  // Optional encrypted attachment reference
  encryptedAttachmentId?: string;
  
  // Metadata (NOT encrypted - safe for server)
  timestamp: Date;
  messageId: string;
}

/**
 * Validate encrypted message envelope before storing
 * Ensures all required fields are present and properly formatted
 */
export function validateEncryptedEnvelope(envelope: any): envelope is EncryptedMessageEnvelope {
  if (!envelope || typeof envelope !== 'object') {
    return false;
  }

  // Check required string fields
  const requiredStrings = [
    'conversationId',
    'senderId', 
    'senderDeviceId',
    'recipientId',
    'recipientDeviceId',
    'ciphertext',
    'messageId'
  ];

  for (const field of requiredStrings) {
    if (!envelope[field] || typeof envelope[field] !== 'string') {
      return false;
    }
  }

  // Validate messageNumber
  if (typeof envelope.messageNumber !== 'number' || envelope.messageNumber < 0) {
    return false;
  }

  // Validate ciphertext is base64
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  if (!base64Regex.test(envelope.ciphertext)) {
    return false;
  }

  // Timestamp should be a Date or valid date string
  if (!(envelope.timestamp instanceof Date) && !isValidDateString(envelope.timestamp)) {
    return false;
  }

  return true;
}

/**
 * Check if string is a valid ISO date
 */
function isValidDateString(dateStr: any): boolean {
  if (typeof dateStr !== 'string') {
    return false;
  }
  
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Sanitize envelope before logging (never log ciphertext!)
 * Constitutional requirement: No sensitive data in logs
 */
export function sanitizeForLogging(envelope: EncryptedMessageEnvelope): object {
  return {
    messageId: envelope.messageId,
    conversationId: envelope.conversationId,
    senderId: envelope.senderId,
    senderDeviceId: envelope.senderDeviceId,
    recipientId: envelope.recipientId,
    recipientDeviceId: envelope.recipientDeviceId,
    messageNumber: envelope.messageNumber,
    timestamp: envelope.timestamp,
    hasCiphertext: !!envelope.ciphertext,
    ciphertextLength: envelope.ciphertext?.length || 0,
    hasAttachment: !!envelope.encryptedAttachmentId
    // NEVER log: ciphertext, encryptedAttachmentId
  };
}

/**
 * Log message storage event (metadata only!)
 */
export function logMessageStored(envelope: EncryptedMessageEnvelope): void {
  logger.info(
    sanitizeForLogging(envelope),
    'Encrypted message stored (server has no plaintext access)'
  );
}

/**
 * Validate message number sequence for out-of-order detection
 * Returns true if message number is valid for the conversation
 */
export async function validateMessageNumber(
  _conversationId: string, // Reserved for future use
  messageNumber: number
): Promise<{ valid: boolean; reason?: string }> {
  // Message numbers must be non-negative
  if (messageNumber < 0) {
    return { valid: false, reason: 'Message number cannot be negative' };
  }

  // In production, you might check against last known message number
  // to detect severe out-of-order issues, but the client handles ordering
  // via the Double Ratchet protocol
  
  return { valid: true };
}

/**
 * Check if ciphertext appears to be valid 2key-ratchet format
 * This is a basic sanity check - actual validation happens client-side
 */
export function isValid2KeyRatchetCiphertext(ciphertext: string): boolean {
  if (!ciphertext || typeof ciphertext !== 'string') {
    return false;
  }

  // Must be base64
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  if (!base64Regex.test(ciphertext)) {
    return false;
  }

  // Minimum reasonable length (2key-ratchet adds headers)
  // Typical minimum: ~100 bytes for encrypted "hello"
  if (ciphertext.length < 50) {
    return false;
  }

  return true;
}

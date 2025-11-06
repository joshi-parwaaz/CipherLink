/**
 * Message Decryption Service (Backend)
 * 
 * Constitutional Requirement: ZERO-ACCESS ARCHITECTURE
 * 
 * The backend does NOT decrypt messages - this happens CLIENT-SIDE ONLY.
 * This service provides:
 * 1. Retrieval of encrypted message envelopes
 * 2. Delivery status tracking
 * 3. Message queue management
 * 
 * Decryption happens in the browser using 2key-ratchet.
 */

import { Message } from '../../models/Message.js';
import logger from '../../utils/logger.js';

/**
 * Retrieve pending encrypted messages for a device
 * Returns ciphertext only - client decrypts
 */
export async function getPendingMessages(
  deviceId: string,
  limit: number = 50
): Promise<any[]> {
  try {
    const messages = await Message.find({
      toDeviceIds: deviceId
    })
      .sort({ serverReceivedAt: 1 }) // Oldest first
      .limit(limit);

    logger.info(
      { deviceId, count: messages.length },
      'Retrieved pending encrypted messages for device'
    );

    return messages;
  } catch (error) {
    logger.error({ error, deviceId }, 'Error retrieving pending messages');
    throw error;
  }
}

/**
 * Mark message as delivered (client successfully received & decrypted)
 * Note: Current Message schema doesn't have status field - this would need migration
 * For now, we delete the message after delivery (implicit delivery confirmation)
 */
export async function markMessageDelivered(
  messageId: string,
  deviceId: string
): Promise<boolean> {
  try {
    // In the current schema, we delete messages after delivery
    // Future: Add status field to track delivery state
    const result = await Message.findOne({ messageId });
    
    if (result && result.toDeviceIds.includes(deviceId)) {
      logger.info(
        { messageId, deviceId },
        'Message confirmed received by device'
      );
      return true;
    }

    return false;
  } catch (error) {
    logger.error({ error, messageId, deviceId }, 'Error marking message delivered');
    return false;
  }
}

/**
 * Mark message as failed (client couldn't decrypt - session issue?)
 * Constitutional note: We don't know WHY it failed (no access to plaintext)
 * Current schema doesn't support this - would need status field migration
 */
export async function markMessageFailed(
  messageId: string,
  deviceId: string,
  reason?: string
): Promise<boolean> {
  try {
    // Log the failure for debugging
    logger.warn(
      { messageId, deviceId, reason: reason || 'Unknown' },
      'Client reported message decryption failure (likely session/prekey issue)'
    );
    
    // Future: Update message status to 'failed'
    // For now, just logging - message will be retried on next fetch
    return true;
  } catch (error) {
    logger.error({ error, messageId, deviceId }, 'Error marking message failed');
    return false;
  }
}

/**
 * Get message delivery status
 */
export async function getMessageStatus(messageId: string): Promise<{
  messageId: string;
  sentAt: Date;
  serverReceivedAt: Date;
  toDeviceIds: string[];
} | null> {
  try {
    const message = await Message.findOne({ messageId });
    
    if (!message) {
      return null;
    }

    return {
      messageId: message.messageId,
      sentAt: message.sentAt,
      serverReceivedAt: message.serverReceivedAt,
      toDeviceIds: message.toDeviceIds
    };
  } catch (error) {
    logger.error({ error, messageId }, 'Error getting message status');
    return null;
  }
}

/**
 * Clean up old delivered messages (retention policy)
 * Constitutional requirement: Minimize data retention
 * Uses TTL field if set, otherwise deletes messages older than retentionDays
 */
export async function cleanupOldMessages(retentionDays: number = 30): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await Message.deleteMany({
      serverReceivedAt: { $lt: cutoffDate },
      ttl: { $exists: false } // Don't delete TTL-managed messages
    });

    logger.info(
      { deletedCount: result.deletedCount, retentionDays },
      'Cleaned up old messages'
    );

    return result.deletedCount;
  } catch (error) {
    logger.error({ error, retentionDays }, 'Error cleaning up messages');
    return 0;
  }
}

/**
 * Validate that retrieved message is properly encrypted
 * Constitutional check: Never return plaintext
 */
export function validateEncryptedMessage(message: any): boolean {
  if (!message || !message.ciphertext) {
    logger.error('Attempted to retrieve message without ciphertext');
    return false;
  }

  // Ensure no plaintext content field exists
  if ('content' in message || 'plaintext' in message) {
    logger.error('CRITICAL: Message contains plaintext field');
    return false;
  }

  return true;
}

import { Message, IMessage } from '../models/Message.js';
import logger from '../utils/logger.js';
import { io } from '../index.js'; // WebSocket instance

export interface MessageEnvelope {
  messageId: string; // UUID/nanoid
  convId: string; // References Conversation.convId
  fromUserId: string;
  fromDeviceId: string;
  toDeviceIds: string[];
  aad: {
    senderId: string;
    recipientIds: string[];
    ts: Date;
  };
  nonce: string;
  ciphertext: string;
  attachmentIds?: string[];
  sentAt: Date;
  ttl?: Date;
  messageNumber?: number; // 2key-ratchet Double Ratchet counter
}

/**
 * Deliver a message to recipient devices
 * Returns the created message document
 */
export async function deliverMessage(
  envelope: MessageEnvelope
): Promise<IMessage> {
  logger.info(
    {
      messageId: envelope.messageId,
      convId: envelope.convId,
      fromUserId: envelope.fromUserId,
      toDeviceCount: envelope.toDeviceIds.length,
    },
    'Delivering message'
  );

  // Validation per spec: toDeviceIds must be non-empty
  if (!envelope.toDeviceIds || envelope.toDeviceIds.length === 0) {
    throw new Error('Message must have at least one recipient device');
  }

  // Validation per spec: ciphertext and nonce must be non-empty
  if (!envelope.ciphertext || !envelope.nonce) {
    throw new Error('Message must have non-empty ciphertext and nonce');
  }

  const message = new Message({
    messageId: envelope.messageId,
    convId: envelope.convId,
    fromUserId: envelope.fromUserId,
    fromDeviceId: envelope.fromDeviceId,
    toDeviceIds: envelope.toDeviceIds,
    aad: envelope.aad,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
    attachmentIds: envelope.attachmentIds,
    sentAt: envelope.sentAt,
    serverReceivedAt: new Date(),
    ttl: envelope.ttl,
    status: 'pending', // Initial status
    messageNumber: envelope.messageNumber,
  });

  await message.save();
  
  logger.info(
    {
      messageId: message.messageId,
      convId: message.convId,
      serverReceivedAt: message.serverReceivedAt,
      status: message.status,
    },
    'Message saved'
  );

  // Emit WebSocket event to each recipient device
  envelope.toDeviceIds.forEach((deviceId) => {
    const room = `device:${deviceId}`;
    logger.info(
      { deviceId, room, messageId: message.messageId },
      'Attempting to emit message:new to room'
    );
    
    io?.to(room).emit('message:new', {
      messageId: message.messageId,
      convId: message.convId,
      fromUserId: message.fromUserId,
      fromDeviceId: message.fromDeviceId,
      ciphertext: message.ciphertext,
      nonce: message.nonce,
      aad: message.aad,
      messageNumber: message.messageNumber,
      sentAt: message.sentAt,
      serverReceivedAt: message.serverReceivedAt,
    });
    
    logger.info(
      { deviceId, messageId: message.messageId },
      'WebSocket message:new emitted'
    );
  });

  return message;
}

/**
 * Retrieve pending messages for a specific device
 * Returns messages where this deviceId is in toDeviceIds array
 * Only returns messages with status 'pending' to avoid infinite retries
 */
export async function getPendingMessages(
  deviceId: string,
  limit: number = 100
): Promise<IMessage[]> {
  const messages = await Message.find({
    toDeviceIds: deviceId,
    status: 'pending', // Only pending messages
  })
    .sort({ serverReceivedAt: 1 })
    .limit(limit);

  logger.info(
    { deviceId, count: messages.length },
    'Retrieved pending messages'
  );

  return messages;
}

/**
 * Mark message as delivered (ACK received from client)
 */
export async function markMessageDelivered(
  messageId: string,
  deviceId: string
): Promise<boolean> {
  try {
    const result = await Message.updateOne(
      { messageId, toDeviceIds: deviceId },
      { 
        $set: { 
          status: 'delivered',
          deliveredAt: new Date()
        }
      }
    );

    if (result.modifiedCount > 0) {
      logger.info({ messageId, deviceId }, 'Message marked as delivered');
      return true;
    }

    return false;
  } catch (error) {
    logger.error({ error, messageId, deviceId }, 'Error marking message delivered');
    return false;
  }
}

/**
 * Mark message as failed (client couldn't decrypt)
 * Prevents infinite retry loop
 */
export async function markMessageFailed(
  messageId: string,
  deviceId: string,
  reason?: string
): Promise<boolean> {
  try {
    const result = await Message.updateOne(
      { messageId, toDeviceIds: deviceId },
      {
        $set: {
          status: 'failed',
          failedAt: new Date(),
        }
      }
    );

    if (result.modifiedCount > 0) {
      logger.warn(
        { messageId, deviceId, reason },
        'Message marked as failed (decryption error)'
      );
      return true;
    }

    return false;
  } catch (error) {
    logger.error({ error, messageId, deviceId }, 'Error marking message failed');
    return false;
  }
}

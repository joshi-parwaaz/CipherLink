import { Types } from 'mongoose';
import { DeliveryReceipt } from '../models/DeliveryReceipt.js';
import logger from '../utils/logger.js';

export interface ReceiptData {
  messageId: string;
  deviceId: string;
  userId: string;
  status: 'delivered' | 'read';
}

/**
 * Record a delivery or read receipt for a message
 */
export async function recordReceipt(data: ReceiptData): Promise<void> {
  try {
    const receipt = new DeliveryReceipt({
      messageId: new Types.ObjectId(data.messageId),
      deviceId: data.deviceId,
      userId: new Types.ObjectId(data.userId),
      status: data.status,
      timestamp: new Date(),
    });

    await receipt.save();

    logger.info(
      {
        messageId: data.messageId,
        deviceId: data.deviceId,
        status: data.status,
      },
      'Receipt recorded'
    );
  } catch (err) {
    // Ignore duplicate key errors (receipt already exists)
    if ((err as any).code === 11000) {
      logger.debug(
        { messageId: data.messageId, deviceId: data.deviceId },
        'Receipt already exists'
      );
      return;
    }
    throw err;
  }
}

/**
 * Get all receipts for a specific message
 */
export async function getReceiptsForMessage(
  messageId: string
): Promise<Array<{ deviceId: string; userId: string; status: string; timestamp: Date }>> {
  const receipts = await DeliveryReceipt.find({
    messageId: new Types.ObjectId(messageId),
  }).select('deviceId userId status timestamp');

  return receipts.map((r) => ({
    deviceId: r.deviceId,
    userId: r.userId.toString(),
    status: r.status,
    timestamp: r.timestamp,
  }));
}

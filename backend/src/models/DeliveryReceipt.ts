import { Schema, model, Document } from 'mongoose';

export interface IDeliveryReceipt extends Document {
  messageId: string; // Message UUID (not ObjectId)
  deviceId: string; // Device that received/read the message
  userId: string; // User UUID (not ObjectId)
  status: 'delivered' | 'read';
  timestamp: Date;
  createdAt: Date;
}

const deliveryReceiptSchema = new Schema<IDeliveryReceipt>(
  {
    messageId: {
      type: String,
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
    },
    userId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['delivered', 'read'],
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Indexes
deliveryReceiptSchema.index({ messageId: 1, deviceId: 1 }, { unique: true });
deliveryReceiptSchema.index({ userId: 1, status: 1 });

export const DeliveryReceipt = model<IDeliveryReceipt>(
  'DeliveryReceipt',
  deliveryReceiptSchema
);

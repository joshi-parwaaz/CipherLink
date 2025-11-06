import { Schema, model, Document } from 'mongoose';

export interface IMessage extends Document {
  messageId: string; // UUID/nanoid per spec
  convId: string; // References Conversation.convId
  fromUserId: string; // User UUID
  fromDeviceId: string; // Device UUID
  toDeviceIds: string[]; // Device fan-out array
  aad: {
    senderId: string;
    recipientIds: string[];
    ts: Date;
  };
  nonce: string; // Base64 encoded bytes
  ciphertext: string; // Base64 encoded bytes
  attachmentIds?: string[]; // Array of attachment UUIDs
  sentAt: Date;
  serverReceivedAt: Date;
  ttl?: Date; // Expiry date per spec
  
  // Message delivery tracking (2key-ratchet migration)
  status?: 'pending' | 'delivered' | 'failed' | 'invalid';
  deliveredAt?: Date;
  failedAt?: Date;
  messageNumber?: number; // For 2key-ratchet Double Ratchet ordering
}

const messageSchema = new Schema<IMessage>(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    convId: {
      type: String,
      required: true,
      index: true,
    },
    fromUserId: {
      type: String,
      required: true,
    },
    fromDeviceId: {
      type: String,
      required: true,
    },
    toDeviceIds: {
      type: [String],
      required: true,
      validate: {
        validator: function (v: string[]) {
          return v.length > 0;
        },
        message: 'Message must have at least one recipient device',
      },
    },
    aad: {
      type: {
        senderId: { type: String, required: true },
        recipientIds: { type: [String], required: true },
        ts: { type: Date, required: true },
      },
      required: true,
    },
    nonce: {
      type: String,
      required: true,
    },
    ciphertext: {
      type: String,
      required: true,
    },
    attachmentIds: {
      type: [String],
    },
    sentAt: {
      type: Date,
      required: true,
    },
    serverReceivedAt: {
      type: Date,
      default: Date.now,
    },
    ttl: {
      type: Date,
      index: true,
    },
    // Delivery tracking fields
    status: {
      type: String,
      enum: ['pending', 'delivered', 'failed', 'invalid'],
      default: 'pending',
      index: true,
    },
    deliveredAt: {
      type: Date,
    },
    failedAt: {
      type: Date,
    },
    messageNumber: {
      type: Number,
      index: true, // For 2key-ratchet message ordering
    },
  },
  {
    timestamps: false, // Using custom sentAt/serverReceivedAt per spec
  }
);

// Indexes per spec: convId+serverReceivedAt (for pagination), toDeviceIds, ttl
messageSchema.index({ convId: 1, serverReceivedAt: -1 });
messageSchema.index({ toDeviceIds: 1 });
messageSchema.index({ ttl: 1 }, { expireAfterSeconds: 0 }); // TTL index

export const Message = model<IMessage>('Message', messageSchema);


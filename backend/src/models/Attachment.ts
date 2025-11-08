import { Schema, model, Document, Types } from 'mongoose';

export interface IAttachment extends Document {
  messageId: Types.ObjectId;
  uploaderId: Types.ObjectId; // User ID
  uploaderDeviceId: string;
  gridFsFileId: Types.ObjectId; // Reference to GridFS file
  encryptedMetadata: string; // Base64 encrypted JSON with filename, mimetype, size
  sizeBytes: number; // Encrypted blob size
  uploadedAt: Date;
  expiresAt?: Date; // Optional TTL
  createdAt: Date;
}

const attachmentSchema = new Schema<IAttachment>(
  {
    messageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      required: true,
      index: true,
    },
    uploaderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    uploaderDeviceId: {
      type: String,
      required: true,
    },
    gridFsFileId: {
      type: Schema.Types.ObjectId,
      required: true,
      unique: true,
    },
    encryptedMetadata: {
      type: String,
      required: true,
    },
    sizeBytes: {
      type: Number,
      required: true,
      min: 0,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Indexes
// Note: gridFsFileId is already indexed due to unique: true constraint
// expiresAt index is needed for TTL functionality

export const Attachment = model<IAttachment>('Attachment', attachmentSchema);

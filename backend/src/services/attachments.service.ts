import { Types } from 'mongoose';
import mongoose from 'mongoose';
import { GridFSBucket, GridFSBucketReadStream } from 'mongodb';
import { Readable } from 'stream';
import { Attachment } from '../models/Attachment.js';
import logger from '../utils/logger.js';

let gridFSBucket: GridFSBucket;

/**
 * Initialize GridFS bucket
 * Call this after MongoDB connection is established
 */
export function initGridFS(): void {
  if (!mongoose.connection.db) {
    throw new Error('MongoDB connection not established');
  }
  gridFSBucket = new GridFSBucket(mongoose.connection.db, {
    bucketName: 'attachments',
  });
  logger.info('GridFS bucket initialized');
}

/**
 * Upload an encrypted attachment blob to GridFS
 * Returns the attachment document
 */
export async function uploadAttachment(
  messageId: string,
  uploaderId: string,
  uploaderDeviceId: string,
  encryptedBlob: Buffer,
  encryptedMetadata: string
): Promise<{ attachmentId: string; gridFsFileId: string }> {
  if (!gridFSBucket) {
    throw new Error('GridFS not initialized');
  }

  // Create a readable stream from the buffer
  const readableStream = Readable.from(encryptedBlob);

  // Upload to GridFS
  const uploadStream = gridFSBucket.openUploadStream('encrypted_attachment', {
    metadata: { uploaderId, uploaderDeviceId },
  });

  const gridFsFileId = uploadStream.id as Types.ObjectId;

  await new Promise((resolve, reject) => {
    readableStream.pipe(uploadStream)
      .on('finish', resolve)
      .on('error', reject);
  });

  // Create attachment document
  const attachment = new Attachment({
    messageId: new Types.ObjectId(messageId),
    uploaderId: new Types.ObjectId(uploaderId),
    uploaderDeviceId,
    gridFsFileId,
    encryptedMetadata,
    sizeBytes: encryptedBlob.length,
  });

  await attachment.save();

  logger.info(
    {
      attachmentId: (attachment._id as Types.ObjectId).toString(),
      gridFsFileId: gridFsFileId.toString(),
      sizeBytes: encryptedBlob.length,
    },
    'Attachment uploaded'
  );

  return {
    attachmentId: (attachment._id as Types.ObjectId).toString(),
    gridFsFileId: gridFsFileId.toString(),
  };
}

/**
 * Download an encrypted attachment blob from GridFS
 */
export async function downloadAttachment(
  attachmentId: string
): Promise<{ stream: GridFSBucketReadStream; metadata: string; sizeBytes: number }> {
  if (!gridFSBucket) {
    throw new Error('GridFS not initialized');
  }

  const attachment = await Attachment.findById(attachmentId);
  if (!attachment) {
    throw new Error('Attachment not found');
  }

  const downloadStream = gridFSBucket.openDownloadStream(attachment.gridFsFileId);

  return {
    stream: downloadStream,
    metadata: attachment.encryptedMetadata,
    sizeBytes: attachment.sizeBytes,
  };
}

/**
 * Delete an attachment from GridFS and the database
 */
export async function deleteAttachment(attachmentId: string): Promise<void> {
  if (!gridFSBucket) {
    throw new Error('GridFS not initialized');
  }

  const attachment = await Attachment.findById(attachmentId);
  if (!attachment) {
    throw new Error('Attachment not found');
  }

  await gridFSBucket.delete(attachment.gridFsFileId);
  await Attachment.findByIdAndDelete(attachmentId);

  logger.info({ attachmentId }, 'Attachment deleted');
}

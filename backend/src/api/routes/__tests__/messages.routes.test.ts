/**
 * Integration Tests: Message Delivery API
 * Tests message send, ACK, and NACK endpoints
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../server.js';
import { Message } from '../../../models/Message.js';
import { User } from '../../../models/User.js';
import { Device } from '../../../models/Device.js';
import { Conversation } from '../../../models/Conversation.js';
import jwt from 'jsonwebtoken';
import { config } from '../../../config/index.js';
import { clearTestDB, setupTestDB, teardownTestDB } from '../../../__tests__/test-setup.js';

const app = createApp();

let senderToken: string;
let receiverToken: string;
let senderId: string;
let senderDeviceId: string;
let receiverId: string;
let receiverDeviceId: string;
let conversationId: string;

beforeAll(async () => {
  await setupTestDB();
});

afterAll(async () => {
  await teardownTestDB();
});

beforeEach(async () => {
  await clearTestDB();

  // Create sender
  senderId = 'sender-123';
  const sender = new User({
    username: 'sender',
    displayName: 'Sender User',
    identityPublicKey: 'c2VuZGVySWRlbnRpdHk=',
    passwordHash: 'hash',
    encryptedIdentityPrivateKey: 'ZW5jcnlwdGVkUHJpdmF0ZUtleQ==',
    privateKeySalt: 'c2FsdA==',
  });
  await sender.save();

  senderDeviceId = 'sender-device-1';
  const senderDevice = new Device({
    userId: senderId,
    deviceId: senderDeviceId,
    deviceName: 'Sender Device',
    status: 'active',
  });
  await senderDevice.save();

  senderToken = jwt.sign(
    { userId: senderId, deviceId: senderDeviceId, username: 'sender' },
    config.jwtSecret,
    { expiresIn: '1h' }
  );

  // Create receiver
  receiverId = 'receiver-456';
  const receiver = new User({
    username: 'receiver',
    displayName: 'Receiver User',
    identityPublicKey: 'cmVjZWl2ZXJJZGVudGl0eQ==',
    passwordHash: 'hash',
    encryptedIdentityPrivateKey: 'ZW5jcnlwdGVkUHJpdmF0ZUtleQ==',
    privateKeySalt: 'c2FsdA==',
  });
  await receiver.save();

  receiverDeviceId = 'receiver-device-1';
  const receiverDevice = new Device({
    userId: receiverId,
    deviceId: receiverDeviceId,
    deviceName: 'Receiver Device',
    status: 'active',
  });
  await receiverDevice.save();

  receiverToken = jwt.sign(
    { userId: receiverId, deviceId: receiverDeviceId, username: 'receiver' },
    config.jwtSecret,
    { expiresIn: '1h' }
  );

  // Create conversation
  conversationId = 'conv-789';
  const conversation = new Conversation({
    convId: conversationId,
    type: 'one_to_one',
    memberUserIds: [senderId, receiverId],
    memberDeviceIds: [senderDeviceId, receiverDeviceId],
    initiatorUserId: senderId,
    status: 'accepted',
    createdAt: new Date(),
  });
  await conversation.save();
});

describe('Message Delivery API', () => {
  // Increase timeout for database operations
  jest.setTimeout(10000);
  it('should send encrypted message successfully', async () => {
    const messageData = {
      messageId: 'test-message-123',
      convId: conversationId,
      toDeviceIds: [receiverDeviceId],
      aad: {
        senderId: senderId,
        recipientIds: [receiverId],
        ts: new Date().toISOString(),
      },
      nonce: 'bm9uY2U=',
      ciphertext: 'ZW5jcnlwdGVkTWVzc2FnZQ==',
      sentAt: new Date().toISOString(),
      messageNumber: 1,
    };

    const response = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${senderToken}`)
      .send(messageData)
      .expect(201);

    expect(response.body.messageId).toBeTruthy();
    expect(response.body.serverReceivedAt).toBeTruthy();

    // Verify message in database
    const message = await Message.findOne({ messageId: response.body.messageId });
    expect(message).toBeTruthy();
    expect(message?.convId).toBe(conversationId);
    expect(message?.fromUserId).toBe(senderId);
    expect(message?.fromDeviceId).toBe(senderDeviceId);
    expect(message?.ciphertext).toBe('ZW5jcnlwdGVkTWVzc2FnZQ==');
    expect(message?.status).toBe('pending');
    expect(message?.messageNumber).toBe(1);
  });

  it('should reject message without authentication', async () => {
    await request(app)
      .post('/api/messages')
      .send({ convId: conversationId, ciphertext: 'test' })
      .expect(401);
  });

  it('should reject message with missing required fields', async () => {
    await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ convId: conversationId }) // Missing ciphertext, nonce, etc.
      .expect(400);
  });

  it('should reject message with invalid base64 ciphertext', async () => {
    await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({
        convId: conversationId,
        toDeviceIds: [receiverDeviceId],
        aad: {
          senderId: senderId,
          recipientIds: [receiverId],
          ts: new Date().toISOString(),
        },
        nonce: 'bm9uY2U=',
        ciphertext: 'not-valid-base64!!!',
      })
      .expect(400);
  });
});

describe('POST /api/messages/ack', () => {
  let testMessageId: string;

  beforeEach(async () => {
    // Create a pending message
    const message = new Message({
      messageId: 'msg-ack-test',
      convId: conversationId,
      fromUserId: senderId,
      fromDeviceId: senderDeviceId,
      toDeviceIds: [receiverDeviceId],
      aad: {
        senderId: senderId,
        recipientIds: [receiverId],
        ts: new Date(),
      },
      nonce: 'bm9uY2U=',
      ciphertext: 'ZW5jcnlwdGVk',
      status: 'pending',
      messageNumber: 1,
      sentAt: new Date(),
      serverReceivedAt: new Date(),
    });
    await message.save();
    testMessageId = message.messageId;
  });

  it('should mark message as delivered', async () => {
    const response = await request(app)
      .post('/api/messages/ack')
      .set('Authorization', `Bearer ${receiverToken}`)
      .send({ messageId: testMessageId })
      .expect(200);

    expect(response.body.success).toBe(true);

    // Verify status updated
    const message = await Message.findOne({ messageId: testMessageId });
    expect(message?.status).toBe('delivered');
    expect(message?.deliveredAt).toBeTruthy();
  });

  it('should reject ACK without authentication', async () => {
    await request(app)
      .post('/api/messages/ack')
      .send({ messageId: testMessageId })
      .expect(401);
  });

  it('should return 404 for non-existent message', async () => {
    await request(app)
      .post('/api/messages/ack')
      .set('Authorization', `Bearer ${receiverToken}`)
      .send({ messageId: 'nonexistent-message' })
      .expect(404);
  });

  it('should reject ACK with missing messageId', async () => {
    await request(app)
      .post('/api/messages/ack')
      .set('Authorization', `Bearer ${receiverToken}`)
      .send({})
      .expect(400);
  });
});

describe('POST /api/messages/nack', () => {
  let testMessageId: string;

  beforeEach(async () => {
    // Create a pending message
    const message = new Message({
      messageId: 'msg-nack-test',
      convId: conversationId,
      fromUserId: senderId,
      fromDeviceId: senderDeviceId,
      toDeviceIds: [receiverDeviceId],
      aad: {
        senderId: senderId,
        recipientIds: [receiverId],
        ts: new Date(),
      },
      nonce: 'bm9uY2U=',
      ciphertext: 'ZW5jcnlwdGVk',
      status: 'pending',
      messageNumber: 1,
      sentAt: new Date(),
      serverReceivedAt: new Date(),
    });
    await message.save();
    testMessageId = message.messageId;
  });

  it('should mark message as failed with reason', async () => {
    const response = await request(app)
      .post('/api/messages/nack')
      .set('Authorization', `Bearer ${receiverToken}`)
      .send({ messageId: testMessageId, reason: 'Decryption failed: Invalid signature' })
      .expect(200);

    expect(response.body.success).toBe(true);

    // Verify status updated
    const message = await Message.findOne({ messageId: testMessageId });
    expect(message?.status).toBe('failed');
    expect(message?.failedAt).toBeTruthy();
  });

  it('should mark message as failed without reason', async () => {
    const response = await request(app)
      .post('/api/messages/nack')
      .set('Authorization', `Bearer ${receiverToken}`)
      .send({ messageId: testMessageId })
      .expect(200);

    expect(response.body.success).toBe(true);

    const message = await Message.findOne({ messageId: testMessageId });
    expect(message?.status).toBe('failed');
  });

  it('should reject NACK without authentication', async () => {
    await request(app)
      .post('/api/messages/nack')
      .send({ messageId: testMessageId })
      .expect(401);
  });

  it('should return 404 for non-existent message', async () => {
    await request(app)
      .post('/api/messages/nack')
      .set('Authorization', `Bearer ${receiverToken}`)
      .send({ messageId: 'nonexistent-message' })
      .expect(404);
  });
});

describe('GET /api/messages/pending', () => {
  beforeEach(async () => {
    // Create multiple messages with different statuses
    await Message.create([
      {
        messageId: 'msg-pending-1',
        convId: conversationId,
        fromUserId: senderId,
        fromDeviceId: senderDeviceId,
        toDeviceIds: [receiverDeviceId],
        aad: {
          senderId: senderId,
          recipientIds: [receiverId],
          ts: new Date(),
        },
        nonce: 'bm9uY2U=',
        ciphertext: 'cGVuZGluZzE=',
        status: 'pending',
        messageNumber: 1,
        sentAt: new Date(),
        serverReceivedAt: new Date(),
      },
      {
        messageId: 'msg-pending-2',
        convId: conversationId,
        fromUserId: senderId,
        fromDeviceId: senderDeviceId,
        toDeviceIds: [receiverDeviceId],
        aad: {
          senderId: senderId,
          recipientIds: [receiverId],
          ts: new Date(),
        },
        nonce: 'bm9uY2U=',
        ciphertext: 'cGVuZGluZzI=',
        status: 'pending',
        messageNumber: 2,
        sentAt: new Date(),
        serverReceivedAt: new Date(),
      },
      {
        messageId: 'msg-delivered-1',
        convId: conversationId,
        fromUserId: senderId,
        fromDeviceId: senderDeviceId,
        toDeviceIds: [receiverDeviceId],
        aad: {
          senderId: senderId,
          recipientIds: [receiverId],
          ts: new Date(),
        },
        nonce: 'bm9uY2U=',
        ciphertext: 'ZGVsaXZlcmVk',
        status: 'delivered',
        messageNumber: 3,
        deliveredAt: new Date(),
        sentAt: new Date(),
        serverReceivedAt: new Date(),
      },
      {
        messageId: 'msg-failed-1',
        convId: conversationId,
        fromUserId: senderId,
        fromDeviceId: senderDeviceId,
        toDeviceIds: [receiverDeviceId],
        aad: {
          senderId: senderId,
          recipientIds: [receiverId],
          ts: new Date(),
        },
        nonce: 'bm9uY2U=',
        ciphertext: 'ZmFpbGVk',
        status: 'failed',
        messageNumber: 4,
        failedAt: new Date(),
        sentAt: new Date(),
        serverReceivedAt: new Date(),
      },
    ]);
  });

  it('should return only pending messages for device', async () => {
    const response = await request(app)
      .get(`/api/messages/pending/${receiverDeviceId}`)
      .set('Authorization', `Bearer ${receiverToken}`)
      .expect(200);

    expect(response.body.messages).toHaveLength(2);
    expect(response.body.messages.every((m: any) => m.status === 'pending')).toBe(true);
    expect(response.body.messages.every((m: any) => m.messageNumber)).toBe(true);
  });

  it('should reject request without authentication', async () => {
    await request(app).get(`/api/messages/pending/${receiverDeviceId}`).expect(401);
  });
});

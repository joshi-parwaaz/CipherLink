/**
 * Schema Validation Tests
 * Validates database schemas meet 2key-ratchet requirements
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { Device } from '../Device.js';
import { Message } from '../Message.js';
import { User } from '../User.js';
import { Conversation } from '../Conversation.js';

const TEST_DB = 'mongodb://localhost:27017/cyphertext-test';

beforeAll(async () => {
  await mongoose.connect(TEST_DB);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Device.deleteMany({});
  await Message.deleteMany({});
  await User.deleteMany({});
  await Conversation.deleteMany({});
});

describe('User Schema', () => {
  it('should enforce required fields', async () => {
    const invalidUser = new User({});
    await expect(invalidUser.validate()).rejects.toThrow();
  });

  it('should accept valid user with identity public key', async () => {
    const user = new User({
      username: 'testuser',
      displayName: 'Test User',
      identityPublicKey: 'dGVzdElkZW50aXR5S2V5', // base64
      passwordHash: 'hashed',
      encryptedIdentityPrivateKey: 'ZW5jcnlwdGVkUHJpdmF0ZUtleQ==',
      privateKeySalt: 'c2FsdA==',
    });
    await expect(user.validate()).resolves.not.toThrow();
    await user.save();
    expect(user.identityPublicKey).toBe('dGVzdElkZW50aXR5S2V5');
  });

  it('should enforce unique username', async () => {
    const user1 = new User({
      username: 'duplicate',
      displayName: 'User One',
      identityPublicKey: 'a2V5MQ==',
      passwordHash: 'hash1',
      encryptedIdentityPrivateKey: 'ZW5jcnlwdGVk',
      privateKeySalt: 'c2FsdA==',
    });
    await user1.save();

    const user2 = new User({
      username: 'duplicate',
      displayName: 'User Two',
      identityPublicKey: 'a2V5Mg==',
      passwordHash: 'hash2',
      encryptedIdentityPrivateKey: 'ZW5jcnlwdGVk',
      privateKeySalt: 'c2FsdA==',
    });
    await expect(user2.save()).rejects.toThrow();
  });
});

describe('Device Schema - 2key-ratchet Fields', () => {
  it('should store complete prekey bundle', async () => {
    const device = new Device({
      userId: 'user-123',
      deviceId: 'device-456',
      deviceName: 'Test Device',
      identityPublicKey: 'aWRlbnRpdHlLZXk=',
      registrationId: 12345,
      signedPreKey: {
        keyId: 1,
        publicKey: 'c2lnbmVkS2V5',
        signature: 'c2lnbmF0dXJl',
      },
      oneTimePreKeys: [
        { keyId: 101, publicKey: 'b3RrMQ==', used: false },
        { keyId: 102, publicKey: 'b3RrMg==', used: false },
      ],
    });

    await device.save();

    const found = await Device.findOne({ deviceId: 'device-456' });
    expect(found?.identityPublicKey).toBe('aWRlbnRpdHlLZXk=');
    expect(found?.registrationId).toBe(12345);
    expect(found?.signedPreKey?.keyId).toBe(1);
    expect(found?.oneTimePreKeys).toHaveLength(2);
  });

  it('should validate base64 format for public keys', async () => {
    const device = new Device({
      userId: 'user-123',
      deviceId: 'device-456',
      deviceName: 'Test Device',
      identityPublicKey: 'not-base64!!!',
    });

    await expect(device.validate()).rejects.toThrow(/base64/i);
  });

  it('should support legacy prekey fields', async () => {
    const device = new Device({
      userId: 'user-123',
      deviceId: 'device-legacy',
      deviceName: 'Legacy Device',
      signedPreKey_legacy: 'bGVnYWN5S2V5',
      signedPreKeySignature_legacy: 'c2ln',
      oneTimePreKeys_legacy: ['b3RrMQ==', 'b3RrMg=='],
    });

    await device.save();
    const found = await Device.findOne({ deviceId: 'device-legacy' });
    expect(found?.signedPreKey_legacy).toBe('bGVnYWN5S2V5');
    expect(found?.oneTimePreKeys_legacy).toHaveLength(2);
  });

  it('should default oneTimePreKeys[].used to false', async () => {
    const device = new Device({
      userId: 'user-123',
      deviceId: 'device-456',
      deviceName: 'Test Device',
      oneTimePreKeys: [{ keyId: 101, publicKey: 'b3RrMQ==' }],
    });

    await device.save();
    const found = await Device.findOne({ deviceId: 'device-456' });
    expect(found?.oneTimePreKeys?.[0].used).toBe(false);
  });

  it('should query unused one-time prekeys efficiently', async () => {
    const device = new Device({
      userId: 'user-123',
      deviceId: 'device-456',
      deviceName: 'Test Device',
      oneTimePreKeys: [
        { keyId: 101, publicKey: 'b3RrMQ==', used: false },
        { keyId: 102, publicKey: 'b3RrMg==', used: true },
        { keyId: 103, publicKey: 'b3RrMw==', used: false },
      ],
    });
    await device.save();

    // Query for devices with unused prekeys
    const found = await Device.findOne({
      deviceId: 'device-456',
      'oneTimePreKeys.used': false,
    });
    expect(found).toBeTruthy();
  });
});

describe('Message Schema - Delivery Tracking', () => {
  it('should default status to pending', async () => {
    const message = new Message({
      messageId: 'msg-123',
      convId: 'conv-456',
      fromUserId: 'user-1',
      fromDeviceId: 'device-1',
      toDeviceIds: ['device-2'],
      aad: {
        senderId: 'user-1',
        recipientIds: ['user-2'],
        ts: new Date(),
      },
      nonce: 'bm9uY2U=',
      ciphertext: 'ZW5jcnlwdGVk',
      sentAt: new Date(),
      serverReceivedAt: new Date(),
    });

    await message.save();
    expect(message.status).toBe('pending');
  });

  it('should accept all valid status values', async () => {
    const statuses = ['pending', 'delivered', 'failed', 'invalid'];
    
    for (const status of statuses) {
      const message = new Message({
        messageId: `msg-${status}`,
        convId: 'conv-456',
        fromUserId: 'user-1',
        fromDeviceId: 'device-1',
        toDeviceIds: ['device-2'],
        aad: {
          senderId: 'user-1',
          recipientIds: ['user-2'],
          ts: new Date(),
        },
        nonce: 'bm9uY2U=',
        ciphertext: 'ZW5jcnlwdGVk',
        status: status as any,
        sentAt: new Date(),
        serverReceivedAt: new Date(),
      });

      await expect(message.save()).resolves.not.toThrow();
    }
  });

  it('should reject invalid status values', async () => {
    const message = new Message({
      messageId: 'msg-123',
      convId: 'conv-456',
      fromUserId: 'user-1',
      fromDeviceId: 'device-1',
      toDeviceIds: ['device-2'],
      aad: {
        senderId: 'user-1',
        recipientIds: ['user-2'],
        ts: new Date(),
      },
      nonce: 'bm9uY2U=',
      ciphertext: 'ZW5jcnlwdGVk',
      status: 'invalid-status' as any,
      sentAt: new Date(),
      serverReceivedAt: new Date(),
    });

    await expect(message.save()).rejects.toThrow();
  });

  it('should store messageNumber for 2key-ratchet ordering', async () => {
    const message = new Message({
      messageId: 'msg-123',
      convId: 'conv-456',
      fromUserId: 'user-1',
      fromDeviceId: 'device-1',
      toDeviceIds: ['device-2'],
      aad: {
        senderId: 'user-1',
        recipientIds: ['user-2'],
        ts: new Date(),
      },
      nonce: 'bm9uY2U=',
      ciphertext: 'ZW5jcnlwdGVk',
      messageNumber: 42,
      sentAt: new Date(),
      serverReceivedAt: new Date(),
    });

    await message.save();
    expect(message.messageNumber).toBe(42);
  });

  it('should store deliveredAt timestamp', async () => {
    const message = new Message({
      messageId: 'msg-123',
      convId: 'conv-456',
      fromUserId: 'user-1',
      fromDeviceId: 'device-1',
      toDeviceIds: ['device-2'],
      aad: {
        senderId: 'user-1',
        recipientIds: ['user-2'],
        ts: new Date(),
      },
      nonce: 'bm9uY2U=',
      ciphertext: 'ZW5jcnlwdGVk',
      status: 'delivered',
      deliveredAt: new Date(),
      sentAt: new Date(),
      serverReceivedAt: new Date(),
    });

    await message.save();
    expect(message.deliveredAt).toBeInstanceOf(Date);
  });

  it('should store failedAt timestamp', async () => {
    const message = new Message({
      messageId: 'msg-123',
      convId: 'conv-456',
      fromUserId: 'user-1',
      fromDeviceId: 'device-1',
      toDeviceIds: ['device-2'],
      aad: {
        senderId: 'user-1',
        recipientIds: ['user-2'],
        ts: new Date(),
      },
      nonce: 'bm9uY2U=',
      ciphertext: 'ZW5jcnlwdGVk',
      status: 'failed',
      failedAt: new Date(),
      sentAt: new Date(),
      serverReceivedAt: new Date(),
    });

    await message.save();
    expect(message.failedAt).toBeInstanceOf(Date);
  });

  it('should query pending messages efficiently', async () => {
    // Create messages with different statuses
    await Message.create([
      {
        messageId: 'msg-pending',
        convId: 'conv-1',
        fromUserId: 'user-1',
        fromDeviceId: 'device-1',
        toDeviceIds: ['device-2'],
        aad: {
          senderId: 'user-1',
          recipientIds: ['user-2'],
          ts: new Date(),
        },
        nonce: 'bm9uY2U=',
        ciphertext: 'cGVuZGluZw==',
        status: 'pending',
        sentAt: new Date(),
        serverReceivedAt: new Date(),
      },
      {
        messageId: 'msg-delivered',
        convId: 'conv-1',
        fromUserId: 'user-1',
        fromDeviceId: 'device-1',
        toDeviceIds: ['device-2'],
        aad: {
          senderId: 'user-1',
          recipientIds: ['user-2'],
          ts: new Date(),
        },
        nonce: 'bm9uY2U=',
        ciphertext: 'ZGVsaXZlcmVk',
        status: 'delivered',
        sentAt: new Date(),
        serverReceivedAt: new Date(),
      },
    ]);

    const pending = await Message.find({ status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0].messageId).toBe('msg-pending');
  });
});

describe('Conversation Schema', () => {
  it('should store memberUserIds array', async () => {
    const conversation = new Conversation({
      convId: 'conv-123',
      type: 'one_to_one',
      memberUserIds: ['user-1', 'user-2'],
      initiatorUserId: 'user-1',
      status: 'accepted',
      createdAt: new Date(),
    });

    await conversation.save();
    expect(conversation.memberUserIds).toHaveLength(2);
  });

  it('should enforce required fields', async () => {
    const conversation = new Conversation({});
    await expect(conversation.validate()).rejects.toThrow();
  });
});

describe('Schema Indexes', () => {
  it('Device should have index on oneTimePreKeys.used', async () => {
    const indexes = await Device.collection.getIndexes();
    const hasUsedIndex = Object.keys(indexes).some(
      (key) => key.includes('oneTimePreKeys.used')
    );
    expect(hasUsedIndex).toBe(true);
  });

  it('Message should have index on status', async () => {
    const indexes = await Message.collection.getIndexes();
    const hasStatusIndex = Object.keys(indexes).some(
      (key) => key.includes('status')
    );
    expect(hasStatusIndex).toBe(true);
  });

  it('Message should have index on messageNumber', async () => {
    const indexes = await Message.collection.getIndexes();
    const hasMessageNumberIndex = Object.keys(indexes).some(
      (key) => key.includes('messageNumber')
    );
    expect(hasMessageNumberIndex).toBe(true);
  });
});

describe('Constitutional Compliance - Zero-Access Validation', () => {
  it('Device should only store PUBLIC keys (no private keys)', async () => {
    const device = new Device({
      userId: 'user-123',
      deviceId: 'device-456',
      deviceName: 'Test Device',
      identityPublicKey: 'cHVibGljS2V5',
      signedPreKey: {
        keyId: 1,
        publicKey: 'c2lnbmVkUHVibGljS2V5',
        signature: 'c2lnbmF0dXJl',
      },
      oneTimePreKeys: [
        { keyId: 101, publicKey: 'b3RrUHVibGljS2V5', used: false },
      ],
    });

    await device.save();

    // Verify schema does NOT have privateKey fields
    const schema = Device.schema.obj;
    expect(schema).not.toHaveProperty('identityPrivateKey');
    expect(schema).not.toHaveProperty('privateKey');
  });

  it('Message should only store CIPHERTEXT (no plaintext)', async () => {
    const message = new Message({
      messageId: 'msg-123',
      convId: 'conv-456',
      fromUserId: 'user-1',
      fromDeviceId: 'device-1',
      toDeviceIds: ['device-2'],
      aad: {
        senderId: 'user-1',
        recipientIds: ['user-2'],
        ts: new Date(),
      },
      nonce: 'bm9uY2U=',
      ciphertext: 'ZW5jcnlwdGVkQ29udGVudA==',
      sentAt: new Date(),
      serverReceivedAt: new Date(),
    });

    await message.save();

    // Verify schema does NOT have plaintext field
    const schema = Message.schema.obj;
    expect(schema).not.toHaveProperty('plaintext');
    expect(schema).not.toHaveProperty('text');
    expect(schema).not.toHaveProperty('content');

    // Verify only ciphertext is stored
    expect(message.ciphertext).toBe('ZW5jcnlwdGVkQ29udGVudA==');
  });

  it('User should only store identity PUBLIC key (no session keys)', async () => {
    const user = new User({
      username: 'testuser',
      displayName: 'Test User',
      identityPublicKey: 'cHVibGljSWRlbnRpdHlLZXk=',
      passwordHash: 'hashed',
      encryptedIdentityPrivateKey: 'ZW5jcnlwdGVk',
      privateKeySalt: 'c2FsdA==',
    });

    await user.save();

    // Verify schema does NOT have session key fields
    const schema = User.schema.obj;
    expect(schema).not.toHaveProperty('sessionKey');
    expect(schema).not.toHaveProperty('privateKey');
    expect(schema).not.toHaveProperty('masterKey');
  });
});

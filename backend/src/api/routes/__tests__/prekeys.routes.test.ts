/**
 * Integration Tests: Prekey API Endpoints
 * Tests the 2key-ratchet prekey management endpoints
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../server.js';
import { Device } from '../../../models/Device.js';
import { User } from '../../../models/User.js';
import jwt from 'jsonwebtoken';
import { config } from '../../../config/index.js';

const TEST_DB = 'mongodb://localhost:27017/cyphertext-test';
const app = createApp();

let authToken: string;
let testUserId: string;
let testDeviceId: string;

beforeAll(async () => {
  await mongoose.connect(TEST_DB);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  // Clear collections
  await Device.deleteMany({});
  await User.deleteMany({});

  // Create test user
  testUserId = 'user-123';
  const user = new User({
    username: 'testuser',
    displayName: 'Test User',
    identityPublicKey: 'dGVzdElkZW50aXR5S2V5', // base64: testIdentityKey
    passwordHash: 'hashedpassword',
    encryptedIdentityPrivateKey: 'ZW5jcnlwdGVkUHJpdmF0ZUtleQ==',
    privateKeySalt: 'c2FsdA==',
  });
  await user.save();

  // Create test device
  testDeviceId = 'device-456';
  const device = new Device({
    userId: testUserId,
    deviceId: testDeviceId,
    deviceName: 'Test Device',
    status: 'active',
  });
  await device.save();

  // Generate auth token
  authToken = jwt.sign(
    { userId: testUserId, deviceId: testDeviceId, username: 'testuser' },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
});

describe('POST /api/prekeys/upload', () => {
  it('should upload prekey bundle successfully', async () => {
    const prekeyBundle = {
      deviceId: testDeviceId,
      identityPublicKey: 'aWRlbnRpdHlQdWJsaWNLZXk=',
      registrationId: 12345,
      signedPreKey: {
        keyId: 1,
        publicKey: 'c2lnbmVkUHJlS2V5',
        signature: 'c2lnbmF0dXJl',
      },
      oneTimePreKeys: [
        { keyId: 101, publicKey: 'b3RrMQ==' },
        { keyId: 102, publicKey: 'b3RrMg==' },
        { keyId: 103, publicKey: 'b3RrMw==' },
      ],
    };

    const response = await request(app)
      .post('/api/prekeys/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .send(prekeyBundle)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.prekeyCount).toBe(3);

    // Verify database
    const device = await Device.findOne({ deviceId: testDeviceId });
    expect(device?.identityPublicKey).toBe('aWRlbnRpdHlQdWJsaWNLZXk=');
    expect(device?.registrationId).toBe(12345);
    expect(device?.signedPreKey?.keyId).toBe(1);
    expect(device?.oneTimePreKeys).toHaveLength(3);
  });

  it('should reject upload without authentication', async () => {
    await request(app)
      .post('/api/prekeys/upload')
      .send({ deviceId: testDeviceId })
      .expect(401);
  });

  it('should reject upload with missing fields', async () => {
    await request(app)
      .post('/api/prekeys/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ deviceId: testDeviceId }) // Missing required fields
      .expect(400);
  });

  it('should reject upload for non-existent device', async () => {
    await request(app)
      .post('/api/prekeys/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        deviceId: 'nonexistent-device',
        identityPublicKey: 'test',
        registrationId: 123,
        signedPreKey: { keyId: 1, publicKey: 'test', signature: 'test' },
      })
      .expect(404);
  });
});

describe('GET /api/prekeys/bundle/:deviceId', () => {
  beforeEach(async () => {
    // Upload prekeys first
    await Device.updateOne(
      { deviceId: testDeviceId },
      {
        $set: {
          identityPublicKey: 'aWRlbnRpdHlQdWJsaWNLZXk=',
          registrationId: 12345,
          signedPreKey: {
            keyId: 1,
            publicKey: 'c2lnbmVkUHJlS2V5',
            signature: 'c2lnbmF0dXJl',
          },
          oneTimePreKeys: [
            { keyId: 101, publicKey: 'b3RrMQ==', used: false },
            { keyId: 102, publicKey: 'b3RrMg==', used: false },
          ],
        },
      }
    );
  });

  it('should retrieve prekey bundle and mark one-time prekey as used', async () => {
    const response = await request(app)
      .get(`/api/prekeys/bundle/${testDeviceId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.deviceId).toBe(testDeviceId);
    expect(response.body.identityPublicKey).toBe('aWRlbnRpdHlQdWJsaWNLZXk=');
    expect(response.body.registrationId).toBe(12345);
    expect(response.body.signedPreKey.keyId).toBe(1);
    expect(response.body.oneTimePreKey).toBeTruthy();
    expect(response.body.oneTimePreKey.keyId).toBe(101);

    // Verify one-time prekey was marked as used
    const device = await Device.findOne({ deviceId: testDeviceId });
    const usedKey = device?.oneTimePreKeys?.find((k) => k.keyId === 101);
    expect(usedKey?.used).toBe(true);
  });

  it('should return bundle without one-time prekey when all are used', async () => {
    // Mark all as used
    await Device.updateOne(
      { deviceId: testDeviceId },
      { $set: { 'oneTimePreKeys.$[].used': true } }
    );

    const response = await request(app)
      .get(`/api/prekeys/bundle/${testDeviceId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.oneTimePreKey).toBeNull();
  });

  it('should return 404 for non-existent device', async () => {
    await request(app)
      .get('/api/prekeys/bundle/nonexistent-device')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });

  it('should return 404 for device without prekey bundle', async () => {
    const newDevice = new Device({
      userId: testUserId,
      deviceId: 'device-no-prekeys',
      deviceName: 'No Prekeys Device',
    });
    await newDevice.save();

    await request(app)
      .get('/api/prekeys/bundle/device-no-prekeys')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });
});

describe('POST /api/prekeys/regenerate', () => {
  beforeEach(async () => {
    await Device.updateOne(
      { deviceId: testDeviceId },
      {
        $set: {
          oneTimePreKeys: [
            { keyId: 101, publicKey: 'b3RrMQ==', used: true },
            { keyId: 102, publicKey: 'b3RrMg==', used: false },
          ],
        },
      }
    );
  });

  it('should add new one-time prekeys', async () => {
    const newKeys = [
      { keyId: 201, publicKey: 'bmV3S2V5MQ==' },
      { keyId: 202, publicKey: 'bmV3S2V5Mg==' },
    ];

    const response = await request(app)
      .post('/api/prekeys/regenerate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ deviceId: testDeviceId, oneTimePreKeys: newKeys })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.totalPrekeys).toBe(4); // 2 old + 2 new
    expect(response.body.unusedPrekeys).toBe(3); // 1 old unused + 2 new

    const device = await Device.findOne({ deviceId: testDeviceId });
    expect(device?.oneTimePreKeys).toHaveLength(4);
  });

  it('should reject regenerate without authentication', async () => {
    await request(app)
      .post('/api/prekeys/regenerate')
      .send({ deviceId: testDeviceId, oneTimePreKeys: [] })
      .expect(401);
  });

  it('should reject invalid oneTimePreKeys format', async () => {
    await request(app)
      .post('/api/prekeys/regenerate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ deviceId: testDeviceId, oneTimePreKeys: 'not-an-array' })
      .expect(400);
  });
});

describe('GET /api/prekeys/status', () => {
  beforeEach(async () => {
    await Device.updateOne(
      { deviceId: testDeviceId },
      {
        $set: {
          identityPublicKey: 'aWRlbnRpdHlQdWJsaWNLZXk=',
          signedPreKey: { keyId: 1, publicKey: 'test', signature: 'test' },
          oneTimePreKeys: [
            { keyId: 1, publicKey: 'k1', used: false },
            { keyId: 2, publicKey: 'k2', used: true },
            { keyId: 3, publicKey: 'k3', used: false },
          ],
        },
      }
    );
  });

  it('should return prekey status for user devices', async () => {
    const response = await request(app)
      .get('/api/prekeys/status')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.devices).toHaveLength(1);
    const deviceStatus = response.body.devices[0];
    expect(deviceStatus.deviceId).toBe(testDeviceId);
    expect(deviceStatus.hasIdentity).toBe(true);
    expect(deviceStatus.hasSignedPreKey).toBe(true);
    expect(deviceStatus.totalPrekeys).toBe(3);
    expect(deviceStatus.unusedPrekeys).toBe(2);
    expect(deviceStatus.needsRegeneration).toBe(true); // < 10 unused
  });

  it('should return empty array for user with no devices', async () => {
    await Device.deleteMany({ userId: testUserId });

    const response = await request(app)
      .get('/api/prekeys/status')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.devices).toHaveLength(0);
  });
});

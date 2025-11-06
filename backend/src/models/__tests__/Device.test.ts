import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { Device, IPreKey, ISignedPreKey } from '../Device';

const TEST_DB = 'mongodb://localhost:27017/cyphertext-test';

beforeAll(async () => {
  await mongoose.connect(TEST_DB);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase(); // Clean up test database
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Device.deleteMany({}); // Clear devices before each test
});

describe('Device Model - 2key-ratchet Schema', () => {
  it('should create device with 2key-ratchet prekey fields', async () => {
    const signedPreKey: ISignedPreKey = {
      keyId: 1,
      publicKey: 'SGVsbG9Xb3JsZA==', // Valid base64
      signature: 'c2lnbmF0dXJl' // Valid base64
    };

    const oneTimePreKeys: IPreKey[] = [
      { keyId: 101, publicKey: 'a2V5MQ==', used: false },
      { keyId: 102, publicKey: 'a2V5Mg==', used: false },
      { keyId: 103, publicKey: 'a2V5Mw==', used: false }
    ];

    const device = new Device({
      userId: 'user123',
      deviceId: 'device-uuid-123',
      deviceName: 'iPhone 13',
      identityPublicKey: 'aWRlbnRpdHlQdWJsaWNLZXk=', // Valid base64
      registrationId: 12345,
      signedPreKey,
      oneTimePreKeys
    });

    const savedDevice = await device.save();

    expect(savedDevice.userId).toBe('user123');
    expect(savedDevice.deviceId).toBe('device-uuid-123');
    expect(savedDevice.identityPublicKey).toBe('aWRlbnRpdHlQdWJsaWNLZXk=');
    expect(savedDevice.registrationId).toBe(12345);
    expect(savedDevice.signedPreKey?.keyId).toBe(1);
    expect(savedDevice.signedPreKey?.publicKey).toBe('SGVsbG9Xb3JsZA==');
    expect(savedDevice.signedPreKey?.signature).toBe('c2lnbmF0dXJl');
    expect(savedDevice.oneTimePreKeys).toHaveLength(3);
    expect(savedDevice.oneTimePreKeys?.[0].used).toBe(false);
  });

  it('should validate base64 format for identityPublicKey', async () => {
    const device = new Device({
      userId: 'user123',
      deviceId: 'device-uuid-456',
      deviceName: 'Chrome Browser',
      identityPublicKey: 'invalid-base64!@#$', // Invalid characters
      registrationId: 67890
    });

    await expect(device.save()).rejects.toThrow(/Identity public key must be valid base64/);
  });

  it('should validate base64 format for signedPreKey.publicKey', async () => {
    const invalidSignedPreKey = {
      keyId: 1,
      publicKey: 'invalid!@#', // Invalid base64
      signature: 'c2lnbmF0dXJl'
    };

    const device = new Device({
      userId: 'user123',
      deviceId: 'device-uuid-789',
      deviceName: 'Android Phone',
      signedPreKey: invalidSignedPreKey
    });

    await expect(device.save()).rejects.toThrow(/Public key must be valid base64/);
  });

  it('should mark one-time prekey as used', async () => {
    const oneTimePreKeys: IPreKey[] = [
      { keyId: 201, publicKey: 'cHJla2V5MQ==', used: false },
      { keyId: 202, publicKey: 'cHJla2V5Mg==', used: false }
    ];

    const device = new Device({
      userId: 'user456',
      deviceId: 'device-uuid-101',
      deviceName: 'MacBook Pro',
      identityPublicKey: 'bWFjYm9va0lkZW50aXR5',
      registrationId: 99999,
      oneTimePreKeys
    });

    const savedDevice = await device.save();

    // Simulate consuming first prekey
    if (savedDevice.oneTimePreKeys && savedDevice.oneTimePreKeys.length > 0) {
      savedDevice.oneTimePreKeys[0].used = true;
      await savedDevice.save();
    }

    const updatedDevice = await Device.findOne({ deviceId: 'device-uuid-101' });
    expect(updatedDevice?.oneTimePreKeys?.[0].used).toBe(true);
    expect(updatedDevice?.oneTimePreKeys?.[1].used).toBe(false);
  });

  it('should support legacy fields during migration', async () => {
    const device = new Device({
      userId: 'user789',
      deviceId: 'device-uuid-legacy',
      deviceName: 'Old Device',
      signedPreKey_legacy: 'bGVnYWN5U2lnbmVkUHJlS2V5',
      signedPreKeySignature_legacy: 'bGVnYWN5U2lnbmF0dXJl',
      oneTimePreKeys_legacy: ['bGVnYWN5T1RLMg==', 'bGVnYWN5T1RLMg==']
    });

    const savedDevice = await device.save();

    expect(savedDevice.signedPreKey_legacy).toBe('bGVnYWN5U2lnbmVkUHJlS2V5');
    expect(savedDevice.signedPreKeySignature_legacy).toBe('bGVnYWN5U2lnbmF0dXJl');
    expect(savedDevice.oneTimePreKeys_legacy).toHaveLength(2);
    // New fields should be undefined/empty
    expect(savedDevice.identityPublicKey).toBeUndefined();
    expect(savedDevice.registrationId).toBeUndefined();
  });

  it('should query unused one-time prekeys efficiently', async () => {
    const oneTimePreKeys: IPreKey[] = [
      { keyId: 301, publicKey: 'dW51c2VkMQ==', used: false },
      { keyId: 302, publicKey: 'dXNlZDE=', used: true },
      { keyId: 303, publicKey: 'dW51c2VkMg==', used: false }
    ];

    const device = new Device({
      userId: 'user999',
      deviceId: 'device-uuid-query-test',
      deviceName: 'Test Device',
      identityPublicKey: 'cXVlcnlUZXN0SWRlbnRpdHk=',
      registrationId: 11111,
      oneTimePreKeys
    });

    await device.save();

    // Query for unused prekeys using the indexed field
    const deviceWithUnused = await Device.findOne({
      deviceId: 'device-uuid-query-test',
      'oneTimePreKeys.used': false
    });

    expect(deviceWithUnused).not.toBeNull();
    const unusedKeys = deviceWithUnused?.oneTimePreKeys?.filter(k => !k.used);
    expect(unusedKeys).toHaveLength(2);
  });

  it('should allow device without prekeys (backward compatibility)', async () => {
    const device = new Device({
      userId: 'user000',
      deviceId: 'device-uuid-minimal',
      deviceName: 'Minimal Device'
    });

    const savedDevice = await device.save();

    expect(savedDevice.identityPublicKey).toBeUndefined();
    expect(savedDevice.registrationId).toBeUndefined();
    expect(savedDevice.signedPreKey).toBeUndefined();
    expect(savedDevice.oneTimePreKeys).toEqual([]);
  });
});

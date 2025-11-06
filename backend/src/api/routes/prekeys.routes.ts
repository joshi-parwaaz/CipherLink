import { Router, Response } from 'express';
import { Device } from '../../models/Device.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/prekeys/upload
 * Upload initial prekey bundle for a device (2key-ratchet)
 */
router.post('/upload', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId, identityPublicKey, registrationId, signedPreKey, oneTimePreKeys } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Validate required fields
    if (!deviceId || !identityPublicKey || registrationId === undefined || !signedPreKey) {
      return res.status(400).json({ error: 'Missing required prekey bundle fields' });
    }

    // Validate signedPreKey structure
    if (!signedPreKey.keyId || !signedPreKey.publicKey || !signedPreKey.signature) {
      return res.status(400).json({ error: 'Invalid signedPreKey structure' });
    }

    // Validate oneTimePreKeys structure if provided
    if (oneTimePreKeys && !Array.isArray(oneTimePreKeys)) {
      return res.status(400).json({ error: 'oneTimePreKeys must be an array' });
    }

    // Check if device exists
    const device = await Device.findOne({ deviceId, userId });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Update device with prekey bundle
    device.identityPublicKey = identityPublicKey;
    device.registrationId = registrationId;
    device.signedPreKey = signedPreKey;
    device.oneTimePreKeys = oneTimePreKeys || [];

    await device.save();

    return res.status(200).json({
      success: true,
      message: 'Prekey bundle uploaded successfully',
      prekeyCount: device.oneTimePreKeys?.length || 0
    });
  } catch (error: any) {
    console.error('Error uploading prekey bundle:', error);
    return res.status(500).json({ error: 'Failed to upload prekey bundle' });
  }
});

/**
 * GET /api/prekeys/bundle/:deviceId
 * Retrieve prekey bundle for initializing a session with target device
 * Marks one one-time prekey as used
 */
router.get('/bundle/:deviceId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;

    const device = await Device.findOne({ deviceId });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Check if device has required prekey data
    if (!device.identityPublicKey || !device.registrationId || !device.signedPreKey) {
      return res.status(404).json({ error: 'Device has no prekey bundle' });
    }

    // Find first unused one-time prekey
    let oneTimePreKey = null;
    if (device.oneTimePreKeys && device.oneTimePreKeys.length > 0) {
      const unusedPrekey = device.oneTimePreKeys.find(k => !k.used);
      if (unusedPrekey) {
        oneTimePreKey = {
          keyId: unusedPrekey.keyId,
          publicKey: unusedPrekey.publicKey
        };
        // Mark as used
        unusedPrekey.used = true;
        await device.save();
      }
    }

    // Return prekey bundle (X3DH format for 2key-ratchet)
    return res.status(200).json({
      deviceId: device.deviceId,
      identityPublicKey: device.identityPublicKey,
      registrationId: device.registrationId,
      signedPreKey: {
        keyId: device.signedPreKey.keyId,
        publicKey: device.signedPreKey.publicKey,
        signature: device.signedPreKey.signature
      },
      oneTimePreKey // null if no unused prekeys available
    });
  } catch (error: any) {
    console.error('Error retrieving prekey bundle:', error);
    return res.status(500).json({ error: 'Failed to retrieve prekey bundle' });
  }
});

/**
 * POST /api/prekeys/regenerate
 * Add new one-time prekeys when running low (< 10 remaining)
 */
router.post('/regenerate', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId, oneTimePreKeys } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!deviceId || !oneTimePreKeys || !Array.isArray(oneTimePreKeys)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const device = await Device.findOne({ deviceId, userId });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Append new prekeys to existing array
    device.oneTimePreKeys = [...(device.oneTimePreKeys || []), ...oneTimePreKeys];
    await device.save();

    const unusedCount = device.oneTimePreKeys.filter(k => !k.used).length;

    return res.status(200).json({
      success: true,
      message: 'One-time prekeys regenerated',
      totalPrekeys: device.oneTimePreKeys.length,
      unusedPrekeys: unusedCount
    });
  } catch (error: any) {
    console.error('Error regenerating prekeys:', error);
    return res.status(500).json({ error: 'Failed to regenerate prekeys' });
  }
});

/**
 * GET /api/prekeys/status
 * Check prekey status for current user's devices
 */
router.get('/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const devices = await Device.find({ userId, status: 'active' });

    const status = devices.map(device => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      hasIdentity: !!device.identityPublicKey,
      hasSignedPreKey: !!device.signedPreKey,
      totalPrekeys: device.oneTimePreKeys?.length || 0,
      unusedPrekeys: device.oneTimePreKeys?.filter(k => !k.used).length || 0,
      needsRegeneration: (device.oneTimePreKeys?.filter(k => !k.used).length || 0) < 10
    }));

    return res.status(200).json({ devices: status });
  } catch (error: any) {
    console.error('Error checking prekey status:', error);
    return res.status(500).json({ error: 'Failed to check prekey status' });
  }
});

export default router;

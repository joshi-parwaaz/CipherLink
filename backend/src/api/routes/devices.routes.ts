import { Router } from 'express';
import { z } from 'zod';
import { Device } from '../../models/Device.js';
import { User } from '../../models/User.js';
import { validateParams } from '../middleware/validate.js';
import logger from '../../utils/logger.js';

const router = Router();

// Validation schemas
const prekeyBundleParams = z.object({
  userId: z.string(),
  deviceId: z.string(),
});

/**
 * GET /api/devices/:userId/:deviceId/prekeys
 * DEPRECATED: Use /api/prekeys/bundle/:deviceId instead
 * This route uses the old X3DH schema - kept for backward compatibility during migration
 */
router.get(
  '/:userId/:deviceId/prekeys',
  validateParams(prekeyBundleParams),
  async (req, res): Promise<void> => {
    try {
      const { userId, deviceId } = req.params;

      // Find the user
      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Find the device
      const device = await Device.findOne({ userId, deviceId });
      if (!device) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }

      // Check if device has legacy fields
      if (!device.signedPreKey_legacy || !device.signedPreKeySignature_legacy) {
        res.status(410).json({ 
          error: 'This device uses new 2key-ratchet schema. Use /api/prekeys/bundle/:deviceId instead' 
        });
        return;
      }

      // Get one-time prekey if available (legacy format)
      let oneTimePreKey: string | undefined;
      // TEMP: Disable one-time prekeys to use 3-DH instead of 4-DH (simpler for now)
      // if (device.oneTimePreKeys_legacy && device.oneTimePreKeys_legacy.length > 0) {
      //   // Pop a one-time prekey
      //   oneTimePreKey = device.oneTimePreKeys_legacy.shift();
      //   await device.save();
      //   logger.info({ userId, deviceId }, 'Legacy one-time prekey consumed');
      // }

      // Return legacy prekey bundle
      res.json({
        identityKey: user.identityPublicKey,
        signedPreKey: device.signedPreKey_legacy,
        signedPreKeySignature: device.signedPreKeySignature_legacy,
        oneTimePreKey, // Will be undefined, so 3-DH instead of 4-DH
      });

      logger.info({ userId, deviceId }, 'Legacy prekey bundle retrieved');
    } catch (err) {
      logger.error({ err }, 'Error retrieving legacy prekey bundle');
      res.status(500).json({ error: 'Failed to retrieve prekey bundle' });
    }
  }
);

/**
 * GET /api/devices/:userId
 * Get all devices for a user
 */
router.get('/:userId', async (req, res): Promise<void> => {
  try {
    const { userId } = req.params;

    logger.info({ 
      userId, 
      type: typeof userId,
      length: userId.length,
      isHex: /^[0-9a-fA-F]{24}$/.test(userId),
    }, 'Looking up devices for user');

    // Validate userId format (should be a 24-character hex string for MongoDB ObjectId)
    if (userId.length !== 24 || !/^[0-9a-fA-F]{24}$/.test(userId)) {
      logger.warn({ userId, length: userId.length }, 'Invalid userId format - not a valid ObjectId string');
      res.status(400).json({ 
        error: 'Invalid user ID format',
        details: 'User ID must be a 24-character hexadecimal string'
      });
      return;
    }

    const devices = await Device.find({ 
      userId,
      status: 'active' // Only return active devices
    }).select(
      'deviceId deviceName lastSeenAt createdAt'
    );

    logger.info({ userId, count: devices.length }, 'Devices found');

    res.json({
      devices: devices.map((d) => ({
        id: d.deviceId,
        name: d.deviceName,
        lastSeenAt: d.lastSeenAt,
        createdAt: d.createdAt,
      })),
    });

    logger.info({ userId, count: devices.length }, 'Devices listed');
  } catch (err) {
    logger.error({ err }, 'Error listing devices');
    res.status(500).json({ error: 'Failed to list devices' });
  }
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import argon2 from 'argon2';
import { User } from '../../models/User.js';
import { Device } from '../../models/Device.js';
import { generateToken } from '../../services/tokens.service.js';
import { validateBody } from '../middleware/validate.js';
import logger from '../../utils/logger.js';

const router = Router();

// Validation schemas
const registerSchema = z.object({
  username: z.string().min(3).max(30).toLowerCase(),
  displayName: z.string().min(1).max(100),
  password: z.string().min(8),
  identityPublicKey: z.string(), // Ed25519 public key (hex)
  encryptedIdentityPrivateKey: z.string(), // Encrypted with password (base64)
  privateKeySalt: z.string(), // Salt for key derivation (base64)
  encryptedSignedPreKeyPrivate: z.string(), // SignedPreKey private encrypted with password (base64)
  signedPreKeySalt: z.string(), // Salt for signedPreKey encryption (base64)
  deviceId: z.string().uuid(),
  deviceName: z.string().min(1).max(100),
  signedPreKey: z.string(),
  signedPreKeySignature: z.string(),
  oneTimePreKeys: z.array(z.string()).optional(),
});

const loginSchema = z.object({
  username: z.string().toLowerCase(),
  password: z.string(),
});

/**
 * POST /api/auth/register
 * Register a new user account and first device
 */
router.post('/register', validateBody(registerSchema), async (req, res): Promise<void> => {
  try {
    const {
      username,
      displayName,
      password,
      identityPublicKey,
      encryptedIdentityPrivateKey,
      privateKeySalt,
      encryptedSignedPreKeyPrivate,
      signedPreKeySalt,
      deviceId,
      deviceName,
      signedPreKey,
      signedPreKeySignature,
      oneTimePreKeys = [],
    } = req.body;

    logger.info({ username, deviceId, deviceName }, 'Registration attempt');

    // Check if username already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      logger.warn({ username }, 'Username already taken');
      res.status(409).json({ error: 'Username already taken' });
      return;
    }

    // Hash password
    const passwordHash = await argon2.hash(password);

    // Create user
    const user = new User({
      username,
      displayName,
      passwordHash,
      identityPublicKey,
      encryptedIdentityPrivateKey,
      privateKeySalt,
      encryptedSignedPreKeyPrivate,
      signedPreKeySalt,
    });

    await user.save();
    logger.info({ userId: user._id, username }, 'User created');

    // Create first device (use string userId)
    // Using legacy fields for backward compatibility with existing frontend
    const device = new Device({
      userId: (user._id as Types.ObjectId).toString(),
      deviceId,
      deviceName,
      signedPreKey_legacy: signedPreKey,
      signedPreKeySignature_legacy: signedPreKeySignature,
      oneTimePreKeys_legacy: oneTimePreKeys,
    });

    await device.save();
    logger.info({ userId: user._id, deviceId }, 'Device created');

    // Generate JWT token
    const token = generateToken({
      userId: (user._id as Types.ObjectId).toString(),
      deviceId,
      username,
    });

    logger.info({ userId: user._id, username }, 'User registered successfully');

    res.status(201).json({
      token,
      user: {
        id: (user._id as Types.ObjectId).toString(), // Convert to string to match Device.userId format
        username: user.username,
        displayName: user.displayName,
        identityPublicKey: user.identityPublicKey,
      },
      device: {
        id: deviceId,
        name: deviceName,
      },
    });
  } catch (err: any) {
    logger.error({ err, message: err.message, stack: err.stack }, 'Registration error');
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

/**
 * POST /api/auth/login
 * Login with existing credentials and register/update device
 */
router.post('/login', validateBody(loginSchema), async (req, res): Promise<void> => {
  try {
    const {
      username,
      password,
    } = req.body;

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Verify password
    const validPassword = await argon2.verify(user.passwordHash, password);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Get user's primary device (first one) - use string userId
    const userIdString = (user._id as Types.ObjectId).toString();
    const device = await Device.findOne({ userId: userIdString });
    const deviceId = device?.deviceId || 'web';

    // Generate JWT token
    const token = generateToken({
      userId: userIdString,
      deviceId,
      username,
    });

    logger.info({ userId: user._id, username, deviceId }, 'User logged in');

    res.json({
      token,
      deviceId, // Include deviceId in response
      signedPreKeyPublic: device?.signedPreKey_legacy, // Include signedPreKey public
      user: {
        id: userIdString, // Use string userId to match Device.userId format
        username: user.username,
        displayName: user.displayName,
        identityPublicKey: user.identityPublicKey,
        encryptedIdentityPrivateKey: user.encryptedIdentityPrivateKey,
        privateKeySalt: user.privateKeySalt,
        encryptedSignedPreKeyPrivate: user.encryptedSignedPreKeyPrivate,
        signedPreKeySalt: user.signedPreKeySalt,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Login error');
    res.status(500).json({ error: 'Login failed' });
  }
});

export default router;

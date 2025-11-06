/**
 * Session Initialization Service (Backend)
 * 
 * Note: Actual 2key-ratchet session initialization happens CLIENT-SIDE ONLY.
 * This service provides helper functions for the backend to:
 * 1. Validate prekey bundles before sending to clients
 * 2. Track session metadata (not the session itself!)
 * 
 * Constitutional requirement: Zero-access architecture
 * - Server NEVER has access to session keys
 * - All encryption/decryption happens in browser
 */

import { Device } from '../../models/Device.js';
import logger from '../../utils/logger.js';

export interface PrekeyBundle {
  deviceId: string;
  identityPublicKey: string;
  registrationId: number;
  signedPreKey: {
    keyId: number;
    publicKey: string;
    signature: string;
  };
  oneTimePreKey?: {
    keyId: number;
    publicKey: string;
  } | null;
}

/**
 * Validate that a prekey bundle has all required fields
 * Used before sending bundle to client for session init
 */
export function validatePrekeyBundle(bundle: any): bundle is PrekeyBundle {
  if (!bundle || typeof bundle !== 'object') {
    return false;
  }

  // Check required fields
  if (!bundle.deviceId || typeof bundle.deviceId !== 'string') {
    return false;
  }

  if (!bundle.identityPublicKey || typeof bundle.identityPublicKey !== 'string') {
    return false;
  }

  if (typeof bundle.registrationId !== 'number') {
    return false;
  }

  // Validate signedPreKey structure
  if (!bundle.signedPreKey || typeof bundle.signedPreKey !== 'object') {
    return false;
  }

  const { signedPreKey } = bundle;
  if (
    typeof signedPreKey.keyId !== 'number' ||
    typeof signedPreKey.publicKey !== 'string' ||
    typeof signedPreKey.signature !== 'string'
  ) {
    return false;
  }

  // oneTimePreKey is optional, but if present must be valid
  if (bundle.oneTimePreKey !== null && bundle.oneTimePreKey !== undefined) {
    const { oneTimePreKey } = bundle;
    if (
      typeof oneTimePreKey.keyId !== 'number' ||
      typeof oneTimePreKey.publicKey !== 'string'
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Check if device needs prekey regeneration (< 10 unused prekeys)
 */
export async function checkPrekeyHealth(deviceId: string): Promise<{
  needsRegeneration: boolean;
  unusedCount: number;
  totalCount: number;
}> {
  try {
    const device = await Device.findOne({ deviceId });
    
    if (!device || !device.oneTimePreKeys) {
      return {
        needsRegeneration: true,
        unusedCount: 0,
        totalCount: 0
      };
    }

    const unusedCount = device.oneTimePreKeys.filter(k => !k.used).length;
    const totalCount = device.oneTimePreKeys.length;

    return {
      needsRegeneration: unusedCount < 10,
      unusedCount,
      totalCount
    };
  } catch (error) {
    logger.error({ error, deviceId }, 'Error checking prekey health');
    return {
      needsRegeneration: true,
      unusedCount: 0,
      totalCount: 0
    };
  }
}

/**
 * Get metadata about active sessions (NOT the sessions themselves!)
 * Returns only non-sensitive information for debugging/monitoring
 */
export async function getSessionMetadata(conversationId: string): Promise<{
  conversationId: string;
  deviceCount: number;
  lastActivity?: Date;
}> {
  // This is a placeholder for session metadata tracking
  // In production, you might track when sessions were last used
  // but NEVER store the actual session keys or state
  
  return {
    conversationId,
    deviceCount: 0, // Would need to query participants
    lastActivity: new Date()
  };
}

/**
 * Validate base64 encoding (all prekeys should be base64)
 */
export function isValidBase64(str: string): boolean {
  if (!str || typeof str !== 'string') {
    return false;
  }
  
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  return base64Regex.test(str);
}

/**
 * Log session initialization (metadata only - no keys!)
 * Constitutional requirement: Never log private key material
 */
export async function logSessionInit(params: {
  initiatorDeviceId: string;
  recipientDeviceId: string;
  conversationId: string;
  hadOneTimePrekey: boolean;
}): Promise<void> {
  logger.info(
    {
      initiatorDeviceId: params.initiatorDeviceId,
      recipientDeviceId: params.recipientDeviceId,
      conversationId: params.conversationId,
      hadOneTimePrekey: params.hadOneTimePrekey,
      timestamp: new Date().toISOString()
    },
    'Session initialized (client-side)'
  );
}

/**
 * Validation utility for localStorage sessions
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a session object
 */
export function validateSession(session: any): ValidationResult {
  // Check if session is an object
  if (!session || typeof session !== 'object') {
    return { valid: false, reason: 'Session is not an object' };
  }

  // Check conversationId is valid UUID
  if (!session.conversationId || !UUID_REGEX.test(session.conversationId)) {
    return { valid: false, reason: 'Invalid conversationId format' };
  }

  // Check ratchetState exists
  if (!session.ratchetState) {
    return { valid: false, reason: 'Missing ratchetState' };
  }

  // Check ratchetState has rootKey (serialized format)
  if (typeof session.ratchetState === 'string') {
    try {
      const parsed = JSON.parse(session.ratchetState);
      if (!parsed.rootKey) {
        return { valid: false, reason: 'RatchetState missing rootKey' };
      }
    } catch (err) {
      return { valid: false, reason: 'Invalid ratchetState JSON' };
    }
  } else if (!session.ratchetState.rootKey) {
    return { valid: false, reason: 'RatchetState missing rootKey' };
  }

  // Check partnerId exists
  if (!session.partnerId || typeof session.partnerId !== 'string') {
    return { valid: false, reason: 'Missing or invalid partnerId' };
  }

  // Check timestamps are valid
  if (session.createdAt && isNaN(new Date(session.createdAt).getTime())) {
    return { valid: false, reason: 'Invalid createdAt timestamp' };
  }

  if (session.lastUsedAt && isNaN(new Date(session.lastUsedAt).getTime())) {
    return { valid: false, reason: 'Invalid lastUsedAt timestamp' };
  }

  return { valid: true };
}

/**
 * Clean invalid sessions from localStorage
 */
export function cleanInvalidSessions(): {
  removed: string[];
  kept: string[];
} {
  const removed: string[] = [];
  const kept: string[] = [];

  const keys = Object.keys(localStorage);
  const sessionKeys = keys.filter(k => k.startsWith('session_'));

  for (const key of sessionKeys) {
    try {
      const serialized = localStorage.getItem(key);
      if (!serialized) {
        removed.push(key);
        continue;
      }

      const session = JSON.parse(serialized);
      const validation = validateSession(session);

      if (!validation.valid) {
        localStorage.removeItem(key);
        removed.push(key);
      } else {
        kept.push(key);
      }
    } catch (err) {
      localStorage.removeItem(key);
      removed.push(key);
    }
  }

  return { removed, kept };
}

/**
 * Get session statistics
 */
export function getSessionStats(): {
  total: number;
  valid: number;
  invalid: number;
  details: Array<{ key: string; valid: boolean; reason?: string }>;
} {
  const keys = Object.keys(localStorage);
  const sessionKeys = keys.filter(k => k.startsWith('session_'));
  const details: Array<{ key: string; valid: boolean; reason?: string }> = [];

  let validCount = 0;
  let invalidCount = 0;

  for (const key of sessionKeys) {
    try {
      const serialized = localStorage.getItem(key);
      if (!serialized) {
        invalidCount++;
        details.push({ key, valid: false, reason: 'Empty or null' });
        continue;
      }

      const session = JSON.parse(serialized);
      const validation = validateSession(session);

      if (validation.valid) {
        validCount++;
        details.push({ key, valid: true });
      } else {
        invalidCount++;
        details.push({ key, valid: false, reason: validation.reason });
      }
    } catch (err) {
      invalidCount++;
      details.push({ 
        key, 
        valid: false, 
        reason: err instanceof Error ? err.message : 'Unknown error' 
      });
    }
  }

  return {
    total: sessionKeys.length,
    valid: validCount,
    invalid: invalidCount,
    details,
  };
}

/**
 * Clear all CipherLink data from localStorage
 */
export function clearAllCipherLinkData(): void {
  const keys = Object.keys(localStorage);
  const cipherLinkKeys = keys.filter(k => 
    k.startsWith('session_') || 
    k.startsWith('cipherlink_') ||
    k === 'userId' ||
    k === 'deviceId' ||
    k === 'authToken' ||
    k === 'identityPrivateKey' ||
    k === 'identityPublicKey' ||
    k === 'signedPreKeyPrivate' ||
    k === 'signedPreKeyPublic'
  );
  cipherLinkKeys.forEach(key => {
    localStorage.removeItem(key);
  });
}

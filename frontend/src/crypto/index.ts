import sodium from 'libsodium-wrappers-sumo';

let isReady = false;

/**
 * Initialize libsodium
 * Must be called before using any crypto functions
 */
export async function initCrypto(): Promise<void> {
  if (isReady) {
    return;
  }

  await sodium.ready;
  isReady = true;
}

/**
 * Check if crypto is ready
 */
export function isCryptoReady(): boolean {
  return isReady;
}

/**
 * Re-export sodium for direct access
 */
export { sodium };

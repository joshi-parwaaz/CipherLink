import { sodium } from './index.js';

/**
 * AEAD (Authenticated Encryption with Associated Data) using XChaCha20-Poly1305
 * This is the core encryption/decryption primitive for message content
 */

export interface EncryptedEnvelope {
  ciphertext: string; // Base64
  nonce: string; // Base64
}

/**
 * Encrypt plaintext using XChaCha20-Poly1305 AEAD
 * @param plaintext - Data to encrypt (Uint8Array or string)
 * @param key - 32-byte encryption key
 * @param additionalData - Optional authenticated associated data (not encrypted, but authenticated)
 * @returns Encrypted envelope with ciphertext and nonce
 */
export function encryptAEAD(
  plaintext: Uint8Array | string,
  key: Uint8Array,
  additionalData?: Uint8Array
): EncryptedEnvelope {
  const plaintextBytes =
    typeof plaintext === 'string'
      ? sodium.from_string(plaintext)
      : plaintext;

  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintextBytes,
    additionalData || null,
    null,
    nonce,
    key
  );

  return {
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
  };
}

/**
 * Decrypt ciphertext using XChaCha20-Poly1305 AEAD
 * @param envelope - Encrypted envelope
 * @param key - 32-byte decryption key
 * @param additionalData - Optional authenticated associated data (must match what was used in encryption)
 * @returns Decrypted plaintext as Uint8Array
 * @throws Error if authentication fails
 */
export function decryptAEAD(
  envelope: EncryptedEnvelope,
  key: Uint8Array,
  additionalData?: Uint8Array
): Uint8Array {
  try {
    const ciphertext = sodium.from_base64(
      envelope.ciphertext,
      sodium.base64_variants.ORIGINAL
    );
    const nonce = sodium.from_base64(
      envelope.nonce,
      sodium.base64_variants.ORIGINAL
    );
    const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      additionalData || null,
      nonce,
      key
    );

    return plaintext;
  } catch (err) {
    throw new Error('AEAD decryption failed: invalid key or tampered ciphertext');
  }
}

/**
 * Decrypt and convert to UTF-8 string
 */
export function decryptAEADToString(
  envelope: EncryptedEnvelope,
  key: Uint8Array,
  additionalData?: Uint8Array
): string {
  const plaintext = decryptAEAD(envelope, key, additionalData);
  return sodium.to_string(plaintext);
}

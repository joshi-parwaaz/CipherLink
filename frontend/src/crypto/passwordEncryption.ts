import { sodium } from './index.js';

/**
 * Password-based key encryption for secure key backup
 * Uses Argon2id for password derivation and XChaCha20-Poly1305 for encryption
 */

/**
 * Encrypt a private key with a password-derived key
 * @param privateKey - The Ed25519 private key to encrypt
 * @param password - User's password
 * @returns Object containing encrypted key and salt
 */
export function encryptPrivateKeyWithPassword(
  privateKey: Uint8Array,
  password: string
): {
  encryptedKey: string; // base64
  salt: string; // base64
} {
  // Generate random salt for key derivation
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);

  // Derive encryption key from password using Argon2id
  const derivedKey = sodium.crypto_pwhash(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    password,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );

  // Generate random nonce
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

  // Encrypt the private key
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    privateKey,
    null, // no additional data
    null,
    nonce,
    derivedKey
  );

  // Combine nonce + ciphertext
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);

  return {
    encryptedKey: sodium.to_base64(combined),
    salt: sodium.to_base64(salt),
  };
}

/**
 * Decrypt a private key using password
 * @param encryptedKey - The encrypted private key (base64)
 * @param salt - The salt used for key derivation (base64)
 * @param password - User's password
 * @returns Decrypted private key
 */
export function decryptPrivateKeyWithPassword(
  encryptedKey: string,
  salt: string,
  password: string
): Uint8Array {
  // Decode from base64
  const saltBytes = sodium.from_base64(salt);
  const combined = sodium.from_base64(encryptedKey);

  // Extract nonce and ciphertext
  const nonceLength = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  const nonce = combined.slice(0, nonceLength);
  const ciphertext = combined.slice(nonceLength);

  // Derive encryption key from password using same parameters
  const derivedKey = sodium.crypto_pwhash(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    password,
    saltBytes,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );

  // Decrypt the private key
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null, // no additional data
    nonce,
    derivedKey
  );

  if (!plaintext) {
    throw new Error('Decryption failed - invalid password or corrupted data');
  }

  return plaintext;
}

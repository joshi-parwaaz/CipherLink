import { sodium } from './index.js';

/**
 * Key generation and management
 * Supports Ed25519 (signing), X25519 (key agreement), and symmetric keys
 */

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface IdentityKeyPair extends KeyPair {
  publicKeyHex: string; // Ed25519 public key as hex
  privateKeyHex: string; // Ed25519 private key as hex
}

export interface PreKeyBundle {
  identityKey: string; // Ed25519 public key (hex)
  signedPreKey: string; // X25519 public key (base64)
  signedPreKeySignature: string; // Ed25519 signature (base64)
  oneTimePreKey?: string; // X25519 public key (base64)
}

/**
 * Generate Ed25519 identity keypair (for signing)
 */
export function generateIdentityKeyPair(): IdentityKeyPair {
  const keyPair = sodium.crypto_sign_keypair();

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyHex: sodium.to_hex(keyPair.publicKey),
    privateKeyHex: sodium.to_hex(keyPair.privateKey),
  };
}

/**
 * Generate X25519 keypair (for Diffie-Hellman key agreement)
 */
export function generateX25519KeyPair(): KeyPair {
  const keyPair = sodium.crypto_box_keypair();

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  };
}

/**
 * Generate a random symmetric key (32 bytes for XChaCha20-Poly1305)
 */
export function generateSymmetricKey(): Uint8Array {
  return sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
}

/**
 * Sign a message using Ed25519
 */
export function signMessage(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return sodium.crypto_sign_detached(message, privateKey);
}

/**
 * Verify an Ed25519 signature
 */
export function verifySignature(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): boolean {
  try {
    return sodium.crypto_sign_verify_detached(signature, message, publicKey);
  } catch {
    return false;
  }
}

/**
 * Perform X25519 Diffie-Hellman key agreement
 * Converts Ed25519 keys to X25519 curve if needed
 */
export function deriveSharedSecret(
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array
): Uint8Array {
  // If keys are Ed25519, convert to X25519
  let x25519Private = myPrivateKey;
  let x25519Public = theirPublicKey;

  // Check key lengths to determine if conversion is needed
  if (myPrivateKey.length === sodium.crypto_sign_SECRETKEYBYTES) {
    x25519Private = sodium.crypto_sign_ed25519_sk_to_curve25519(myPrivateKey);
  }

  if (theirPublicKey.length === sodium.crypto_sign_PUBLICKEYBYTES) {
    x25519Public = sodium.crypto_sign_ed25519_pk_to_curve25519(theirPublicKey);
  }

  return sodium.crypto_scalarmult(x25519Private, x25519Public);
}

/**
 * Convert Ed25519 public key to X25519
 */
export function ed25519PublicToX25519(ed25519PublicKey: Uint8Array): Uint8Array {
  return sodium.crypto_sign_ed25519_pk_to_curve25519(ed25519PublicKey);
}

/**
 * Convert Ed25519 secret key to X25519
 */
export function ed25519SecretToX25519(ed25519SecretKey: Uint8Array): Uint8Array {
  return sodium.crypto_sign_ed25519_sk_to_curve25519(ed25519SecretKey);
}

/**
 * Derive a key from a shared secret using KDF
 */
export function deriveKey(
  sharedSecret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number = 32
): Uint8Array {
  // Use crypto_generichash (Blake2b) as KDF
  const input = new Uint8Array([...sharedSecret, ...salt, ...info]);
  const key = sodium.crypto_generichash(length, input);
  return key;
}

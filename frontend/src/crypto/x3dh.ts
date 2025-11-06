import { sodium } from './index.js';
import { generateX25519KeyPair, signMessage, verifySignature, KeyPair } from './keys.js';

/**
 * X3DH (Extended Triple Diffie-Hellman) Key Agreement Protocol
 * Used for initial session setup between two parties
 */

export interface X3DHBundle {
  identityKey: Uint8Array; // Ed25519 public key
  signedPreKey: Uint8Array; // X25519 public key
  signedPreKeySignature: Uint8Array;
  oneTimePreKey?: Uint8Array; // X25519 public key (optional)
}

export interface X3DHResult {
  sharedSecret: Uint8Array; // 32-byte shared secret for Double Ratchet initialization
  ephemeralPublicKey: Uint8Array; // Our ephemeral public key to send to recipient
}

/**
 * Initiate X3DH as Alice (sender)
 * @param ourIdentityKeyPair - Our long-term Ed25519 identity keypair
 * @param theirBundle - Recipient's prekey bundle
 * @returns Shared secret and our ephemeral public key
 */
export function x3dhInitiate(
  ourIdentityKeyPair: KeyPair,
  theirBundle: X3DHBundle
): X3DHResult {
  // Verify the signed prekey signature
  const isValid = verifySignature(
    theirBundle.signedPreKeySignature,
    theirBundle.signedPreKey,
    theirBundle.identityKey
  );

  if (!isValid) {
    throw new Error('X3DH: Invalid signed prekey signature');
  }

  // Convert Ed25519 identity keys to X25519 for DH
  const ourIdentityX25519 = sodium.crypto_sign_ed25519_sk_to_curve25519(
    ourIdentityKeyPair.privateKey
  );
  const theirIdentityX25519 = sodium.crypto_sign_ed25519_pk_to_curve25519(
    theirBundle.identityKey
  );

  // Generate ephemeral keypair
  const ephemeralKeyPair = generateX25519KeyPair();

  // Perform 4 Diffie-Hellman operations
  const dh1 = sodium.crypto_scalarmult(ourIdentityX25519, theirBundle.signedPreKey);
  const dh2 = sodium.crypto_scalarmult(
    ephemeralKeyPair.privateKey,
    theirIdentityX25519
  );
  const dh3 = sodium.crypto_scalarmult(
    ephemeralKeyPair.privateKey,
    theirBundle.signedPreKey
  );

  let dh4: Uint8Array | null = null;
  if (theirBundle.oneTimePreKey) {
    dh4 = sodium.crypto_scalarmult(
      ephemeralKeyPair.privateKey,
      theirBundle.oneTimePreKey
    );
  }

  // Concatenate DH outputs
  const dhOutputs = dh4
    ? new Uint8Array([...dh1, ...dh2, ...dh3, ...dh4])
    : new Uint8Array([...dh1, ...dh2, ...dh3]);

  // Derive shared secret using HKDF
  const sharedSecret = deriveX3DHSecret(dhOutputs);

  return {
    sharedSecret,
    ephemeralPublicKey: ephemeralKeyPair.publicKey,
  };
}

/**
 * Respond to X3DH as Bob (receiver)
 * @param ourIdentityKeyPair - Our long-term Ed25519 identity keypair
 * @param ourSignedPreKeyPair - Our signed prekey pair (X25519)
 * @param ourOneTimePreKey - Our one-time prekey (X25519), if used
 * @param theirIdentityKey - Sender's Ed25519 identity public key
 * @param theirEphemeralKey - Sender's ephemeral X25519 public key
 * @returns Shared secret
 */
export function x3dhRespond(
  ourIdentityKeyPair: KeyPair,
  ourSignedPreKeyPair: KeyPair,
  theirIdentityKey: Uint8Array,
  theirEphemeralKey: Uint8Array,
  ourOneTimePreKey?: Uint8Array
): Uint8Array {
  // Convert Ed25519 identity keys to X25519
  const ourIdentityX25519 = sodium.crypto_sign_ed25519_sk_to_curve25519(
    ourIdentityKeyPair.privateKey
  );
  const theirIdentityX25519 = sodium.crypto_sign_ed25519_pk_to_curve25519(
    theirIdentityKey
  );

  // Perform 4 Diffie-Hellman operations (same as initiator, but reversed)
  const dh1 = sodium.crypto_scalarmult(
    ourSignedPreKeyPair.privateKey,
    theirIdentityX25519
  );
  const dh2 = sodium.crypto_scalarmult(ourIdentityX25519, theirEphemeralKey);
  const dh3 = sodium.crypto_scalarmult(
    ourSignedPreKeyPair.privateKey,
    theirEphemeralKey
  );

  let dh4: Uint8Array | null = null;
  if (ourOneTimePreKey) {
    dh4 = sodium.crypto_scalarmult(ourOneTimePreKey, theirEphemeralKey);
  }

  // Concatenate DH outputs
  const dhOutputs = dh4
    ? new Uint8Array([...dh1, ...dh2, ...dh3, ...dh4])
    : new Uint8Array([...dh1, ...dh2, ...dh3]);

  // Derive shared secret using HKDF
  return deriveX3DHSecret(dhOutputs);
}

/**
 * Derive X3DH shared secret from concatenated DH outputs
 */
function deriveX3DHSecret(dhOutputs: Uint8Array): Uint8Array {
  // Use crypto_generichash as KDF (Blake2b)
  const key = sodium.crypto_generichash(32, dhOutputs);
  return key;
}

/**
 * Create a prekey bundle for publishing to server
 */
export function createPreKeyBundle(
  identityKeyPair: KeyPair,
  signedPreKeyPair: KeyPair,
  oneTimePreKeys?: Uint8Array[]
): {
  identityKey: string;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKeys?: string[];
} {
  // Sign the prekey
  const signature = signMessage(signedPreKeyPair.publicKey, identityKeyPair.privateKey);

  return {
    identityKey: sodium.to_hex(identityKeyPair.publicKey),
    signedPreKey: sodium.to_base64(
      signedPreKeyPair.publicKey,
      sodium.base64_variants.ORIGINAL
    ),
    signedPreKeySignature: sodium.to_base64(signature, sodium.base64_variants.ORIGINAL),
    oneTimePreKeys: oneTimePreKeys?.map((key) =>
      sodium.to_base64(key, sodium.base64_variants.ORIGINAL)
    ),
  };
}

/**
 * Parse a prekey bundle received from server
 */
export function parsePreKeyBundle(bundle: {
  identityKey: string;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKey?: string;
}): X3DHBundle {
  return {
    identityKey: sodium.from_hex(bundle.identityKey),
    signedPreKey: sodium.from_base64(bundle.signedPreKey, sodium.base64_variants.ORIGINAL),
    signedPreKeySignature: sodium.from_base64(
      bundle.signedPreKeySignature,
      sodium.base64_variants.ORIGINAL
    ),
    oneTimePreKey: bundle.oneTimePreKey
      ? sodium.from_base64(bundle.oneTimePreKey, sodium.base64_variants.ORIGINAL)
      : undefined,
  };
}

/**
 * Generate a batch of one-time prekeys
 */
export function generateOneTimePreKeys(count: number): Uint8Array[] {
  const keys: Uint8Array[] = [];

  for (let i = 0; i < count; i++) {
    const keyPair = generateX25519KeyPair();
    keys.push(keyPair.publicKey);
  }

  return keys;
}

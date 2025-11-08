import { sodium } from './index.js';
import { generateX25519KeyPair } from './keys.js';
import { encryptAEAD, decryptAEAD, EncryptedEnvelope } from './aead.js';

/**
 * Double Ratchet Algorithm Implementation
 * Provides forward secrecy and break-in recovery for messaging
 */

export interface RatchetState {
  // Root chain
  rootKey: Uint8Array;

  // Sending chain
  sendingChainKey?: Uint8Array;
  sendingRatchetKey?: Uint8Array;
  sendingMessageNumber: number;

  // Receiving chain
  receivingChainKey?: Uint8Array;
  receivingRatchetKey?: Uint8Array;
  receivingMessageNumber: number;

  // DH ratchet
  dhSendingKey?: Uint8Array; // Our current sending ephemeral key
  dhReceivingKey?: Uint8Array; // Their current receiving ephemeral key

  // Skipped message keys (for out-of-order delivery)
  skippedMessageKeys: Map<string, Uint8Array>; // key: "publicKey:messageNumber" -> messageKey
}

const MAX_SKIP = 1000; // Maximum number of message keys to skip

/**
 * Initialize ratchet state as Alice (initiator)
 */
export function initializeRatchetAlice(
  sharedSecret: Uint8Array,
  theirRatchetPublicKey: Uint8Array
): RatchetState {
  const dhKeyPair = generateX25519KeyPair();

  // Perform initial DH (both keys are already X25519, use direct scalarmult)
  const dhOutput = sodium.crypto_scalarmult(dhKeyPair.privateKey, theirRatchetPublicKey);

  // KDF to get root key and sending chain key
  const { rootKey, chainKey } = kdfRootKey(sharedSecret, dhOutput);

  return {
    rootKey,
    sendingChainKey: chainKey,
    sendingRatchetKey: dhKeyPair.privateKey,
    sendingMessageNumber: 0,
    receivingChainKey: undefined,
    receivingRatchetKey: undefined,
    receivingMessageNumber: 0,
    dhSendingKey: dhKeyPair.publicKey,
    dhReceivingKey: theirRatchetPublicKey,
    skippedMessageKeys: new Map(),
  };
}

/**
 * Initialize ratchet state as Bob (receiver)
 */
export function initializeRatchetBob(
  sharedSecret: Uint8Array,
  ourRatchetKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array }
): RatchetState {
  return {
    rootKey: sharedSecret,
    sendingChainKey: undefined,
    sendingRatchetKey: ourRatchetKeyPair.privateKey,
    sendingMessageNumber: 0,
    receivingChainKey: undefined,
    receivingRatchetKey: undefined,
    receivingMessageNumber: 0,
    dhSendingKey: ourRatchetKeyPair.publicKey,
    dhReceivingKey: undefined,
    skippedMessageKeys: new Map(),
  };
}

/**
 * Encrypt a message using the ratchet
 */
export function ratchetEncrypt(
  state: RatchetState,
  plaintext: Uint8Array | string
): { envelope: EncryptedEnvelope; header: RatchetHeader } {
  // Derive message key from sending chain
  const { messageKey, nextChainKey } = kdfChainKey(state.sendingChainKey!);

  // Encrypt the message
  const envelope = encryptAEAD(plaintext, messageKey);

  // Create header
  const header: RatchetHeader = {
    dhPublicKey: sodium.to_base64(state.dhSendingKey!, sodium.base64_variants.ORIGINAL),
    messageNumber: state.sendingMessageNumber,
    previousChainLength: state.sendingMessageNumber,
  };

  // Update state
  state.sendingChainKey = nextChainKey;
  state.sendingMessageNumber += 1;

  return { envelope, header };
}

/**
 * Decrypt a message using the ratchet
 */
export function ratchetDecrypt(
  state: RatchetState,
  envelope: EncryptedEnvelope,
  header: RatchetHeader
): Uint8Array {
  const theirPublicKey = sodium.from_base64(
    header.dhPublicKey,
    sodium.base64_variants.ORIGINAL
  );

  // Check if this is a new ratchet (DH key changed)
  const isNewRatchet =
    !state.dhReceivingKey ||
    !arraysEqual(state.dhReceivingKey, theirPublicKey);

  if (isNewRatchet) {
    // Skip messages in the previous receiving chain
    skipMessageKeys(state, header.previousChainLength);

    // Perform DH ratchet step
    dhRatchetStep(state, theirPublicKey);
  }

  // Try to get skipped message key
  const skippedKey = trySkippedMessageKeys(state, header);
  if (skippedKey) {
    return decryptAEAD(envelope, skippedKey);
  }

  // Skip messages in current receiving chain
  skipMessageKeys(state, header.messageNumber);

  // Derive message key
  const { messageKey, nextChainKey } = kdfChainKey(state.receivingChainKey!);
  state.receivingChainKey = nextChainKey;
  state.receivingMessageNumber += 1;

  // Decrypt
  return decryptAEAD(envelope, messageKey);
}

/**
 * Perform a DH ratchet step when receiving a new public key
 */
function dhRatchetStep(state: RatchetState, theirNewPublicKey: Uint8Array): void {
  state.receivingRatchetKey = theirNewPublicKey;
  state.dhReceivingKey = theirNewPublicKey;

  // Perform receiving DH (both keys are X25519)
  const dhOutput = sodium.crypto_scalarmult(state.sendingRatchetKey!, theirNewPublicKey);
  const { rootKey, chainKey } = kdfRootKey(state.rootKey, dhOutput);

  state.rootKey = rootKey;
  state.receivingChainKey = chainKey;
  state.receivingMessageNumber = 0;

  // Generate new sending key pair
  const newSendingKeyPair = generateX25519KeyPair();
  state.sendingRatchetKey = newSendingKeyPair.privateKey;
  state.dhSendingKey = newSendingKeyPair.publicKey;

  // Perform sending DH (both keys are X25519)
  const sendingDhOutput = sodium.crypto_scalarmult(newSendingKeyPair.privateKey, theirNewPublicKey);
  const sendingKdf = kdfRootKey(state.rootKey, sendingDhOutput);

  state.rootKey = sendingKdf.rootKey;
  state.sendingChainKey = sendingKdf.chainKey;
  state.sendingMessageNumber = 0;

  // Clear skipped message keys as they become invalid after DH ratchet
  state.skippedMessageKeys.clear();
}

/**
 * Skip message keys and store them for later decryption
 */
function skipMessageKeys(state: RatchetState, until: number): void {
  if (!state.receivingChainKey) {
    return;
  }

  if (state.receivingMessageNumber + MAX_SKIP < until) {
    throw new Error('Too many skipped messages');
  }

  while (state.receivingMessageNumber < until) {
    const { messageKey, nextChainKey } = kdfChainKey(state.receivingChainKey);

    // Store the skipped key
    const keyId = `${sodium.to_base64(state.dhReceivingKey!, sodium.base64_variants.ORIGINAL)}:${state.receivingMessageNumber}`;
    state.skippedMessageKeys.set(keyId, messageKey);

    state.receivingChainKey = nextChainKey;
    state.receivingMessageNumber += 1;
  }

  // Limit the number of skipped keys to prevent memory leaks
  limitSkippedMessageKeys(state);
}

/**
 * Limit the number of skipped message keys to prevent memory leaks
 */
function limitSkippedMessageKeys(state: RatchetState): void {
  const maxSkippedKeys = 200; // Allow up to 200 skipped keys

  if (state.skippedMessageKeys.size > maxSkippedKeys) {
    // Remove oldest keys (lowest message numbers)
    const keysToRemove = state.skippedMessageKeys.size - maxSkippedKeys;
    const sortedKeys = Array.from(state.skippedMessageKeys.keys()).sort();

    for (let i = 0; i < keysToRemove; i++) {
      state.skippedMessageKeys.delete(sortedKeys[i]);
    }

    console.warn(`[ratchet] Cleared ${keysToRemove} old skipped message keys to prevent memory leak`);
  }
}

/**
 * Try to decrypt using a skipped message key
 */
function trySkippedMessageKeys(
  state: RatchetState,
  header: RatchetHeader
): Uint8Array | null {
  const keyId = `${header.dhPublicKey}:${header.messageNumber}`;
  const messageKey = state.skippedMessageKeys.get(keyId);

  if (messageKey) {
    state.skippedMessageKeys.delete(keyId);
    return messageKey;
  }

  return null;
}

/**
 * KDF for root key ratchet
 */
function kdfRootKey(
  rootKey: Uint8Array,
  dhOutput: Uint8Array
): { rootKey: Uint8Array; chainKey: Uint8Array } {
  // Use crypto_generichash (Blake2b) as KDF
  const input = new Uint8Array([...rootKey, ...dhOutput]);
  const okm = sodium.crypto_generichash(64, input);

  return {
    rootKey: okm.slice(0, 32),
    chainKey: okm.slice(32, 64),
  };
}

/**
 * KDF for chain key ratchet
 */
function kdfChainKey(
  chainKey: Uint8Array
): { messageKey: Uint8Array; nextChainKey: Uint8Array } {
  // Use HMAC for chain key ratcheting
  const messageKeyInput = sodium.from_string('CypherTextMessage');
  const messageKey = sodium.crypto_auth(messageKeyInput, chainKey).slice(0, 32);

  const chainKeyInput = sodium.from_string('CypherTextChain');
  const nextChainKey = sodium.crypto_auth(chainKeyInput, chainKey).slice(0, 32);

  return { messageKey, nextChainKey };
}

/**
 * Header attached to each message
 */
export interface RatchetHeader {
  dhPublicKey: string; // Base64 encoded
  messageNumber: number;
  previousChainLength: number;
  ephemeralKey?: string; // Base64 encoded X3DH ephemeral key (only in first message)
  senderIdentityKey?: string; // Base64 encoded sender identity key (only in first message)
}

/**
 * Helper to compare arrays
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Validate ratchet state for encryption operations
 */
export function validateRatchetStateForEncryption(state: RatchetState): void {
  if (!state.rootKey || state.rootKey.length === 0) {
    throw new Error('Invalid ratchet state: missing or empty root key');
  }

  if (!state.sendingChainKey || state.sendingChainKey.length === 0) {
    throw new Error('Invalid ratchet state: missing or empty sending chain key');
  }

  if (!state.dhSendingKey || state.dhSendingKey.length === 0) {
    throw new Error('Invalid ratchet state: missing or empty DH sending key');
  }

  if (state.sendingMessageNumber < 0) {
    throw new Error('Invalid ratchet state: negative sending message number');
  }

  if (!state.skippedMessageKeys) {
    throw new Error('Invalid ratchet state: missing skipped message keys map');
  }
}

/**
 * Validate ratchet state for decryption operations
 */
export function validateRatchetStateForDecryption(state: RatchetState): void {
  if (!state.rootKey || state.rootKey.length === 0) {
    throw new Error('Invalid ratchet state: missing or empty root key');
  }

  if (state.receivingMessageNumber < 0) {
    throw new Error('Invalid ratchet state: negative receiving message number');
  }

  if (!state.skippedMessageKeys) {
    throw new Error('Invalid ratchet state: missing skipped message keys map');
  }

  // Note: receivingChainKey may be undefined initially, but should be set after first DH ratchet
  // dhReceivingKey may also be undefined initially
}

/**
 * Serialize ratchet state for storage
 */
export function serializeRatchetState(state: RatchetState): string {
  const serializable = {
    rootKey: sodium.to_base64(state.rootKey, sodium.base64_variants.ORIGINAL),
    sendingChainKey: state.sendingChainKey
      ? sodium.to_base64(state.sendingChainKey, sodium.base64_variants.ORIGINAL)
      : undefined,
    sendingRatchetKey: state.sendingRatchetKey
      ? sodium.to_base64(state.sendingRatchetKey, sodium.base64_variants.ORIGINAL)
      : undefined,
    sendingMessageNumber: state.sendingMessageNumber,
    receivingChainKey: state.receivingChainKey
      ? sodium.to_base64(state.receivingChainKey, sodium.base64_variants.ORIGINAL)
      : undefined,
    receivingRatchetKey: state.receivingRatchetKey
      ? sodium.to_base64(state.receivingRatchetKey, sodium.base64_variants.ORIGINAL)
      : undefined,
    receivingMessageNumber: state.receivingMessageNumber,
    dhSendingKey: state.dhSendingKey
      ? sodium.to_base64(state.dhSendingKey, sodium.base64_variants.ORIGINAL)
      : undefined,
    dhReceivingKey: state.dhReceivingKey
      ? sodium.to_base64(state.dhReceivingKey, sodium.base64_variants.ORIGINAL)
      : undefined,
    skippedMessageKeys: Array.from(state.skippedMessageKeys.entries()).map(
      ([key, value]) => [key, sodium.to_base64(value, sodium.base64_variants.ORIGINAL)]
    ),
  };

  return JSON.stringify(serializable);
}

/**
 * Deserialize ratchet state from storage
 */
export function deserializeRatchetState(serialized: string): RatchetState {
  const data = JSON.parse(serialized);

  return {
    rootKey: sodium.from_base64(data.rootKey, sodium.base64_variants.ORIGINAL),
    sendingChainKey: data.sendingChainKey
      ? sodium.from_base64(data.sendingChainKey, sodium.base64_variants.ORIGINAL)
      : undefined,
    sendingRatchetKey: data.sendingRatchetKey
      ? sodium.from_base64(data.sendingRatchetKey, sodium.base64_variants.ORIGINAL)
      : undefined,
    sendingMessageNumber: data.sendingMessageNumber,
    receivingChainKey: data.receivingChainKey
      ? sodium.from_base64(data.receivingChainKey, sodium.base64_variants.ORIGINAL)
      : undefined,
    receivingRatchetKey: data.receivingRatchetKey
      ? sodium.from_base64(data.receivingRatchetKey, sodium.base64_variants.ORIGINAL)
      : undefined,
    receivingMessageNumber: data.receivingMessageNumber,
    dhSendingKey: data.dhSendingKey
      ? sodium.from_base64(data.dhSendingKey, sodium.base64_variants.ORIGINAL)
      : undefined,
    dhReceivingKey: data.dhReceivingKey
      ? sodium.from_base64(data.dhReceivingKey, sodium.base64_variants.ORIGINAL)
      : undefined,
    skippedMessageKeys: new Map(
      data.skippedMessageKeys.map(([key, value]: [string, string]) => [
        key,
        sodium.from_base64(value, sodium.base64_variants.ORIGINAL),
      ])
    ),
  };
}

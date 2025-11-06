import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { RatchetState } from '../crypto/ratchet.js';

/**
 * IndexedDB storage for offline-first messaging
 * Stores ratchet states, outbox messages, and message cache
 */

interface CypherTextDB extends DBSchema {
  ratchetStates: {
    key: string; // conversationId:deviceId
    value: {
      id: string;
      conversationId: string;
      deviceId: string;
      state: string; // Serialized RatchetState
      updatedAt: number;
    };
  };
  outbox: {
    key: string; // messageId
    value: {
      id: string;
      conversationId: string;
      recipientId: string;
      ciphertext: string;
      timestamp: number;
      attempts: number;
      status: 'pending' | 'sent' | 'failed';
    };
    indexes: { 'by-status': string; 'by-conversation': string };
  };
  messageCache: {
    key: string; // messageId
    value: {
      id: string;
      conversationId: string;
      senderId: string;
      plaintext: string;
      timestamp: number;
      status: 'delivered' | 'read';
    };
    indexes: { 'by-conversation': string; 'by-timestamp': number };
  };
  conversations: {
    key: string; // conversationId
    value: {
      id: string;
      type: 'direct' | 'group';
      participants: string[];
      lastMessageAt: number;
      unreadCount: number;
    };
  };
  identityKeys: {
    key: string; // userId
    value: {
      userId: string;
      publicKey: string;
      privateKey: string;
      createdAt: number;
    };
  };
}

let db: IDBPDatabase<CypherTextDB> | null = null;

/**
 * Initialize IndexedDB
 */
export async function initStorage(): Promise<void> {
  if (db) {
    return;
  }

  db = await openDB<CypherTextDB>('cyphertext-db', 1, {
    upgrade(db) {
      // Ratchet states store
      if (!db.objectStoreNames.contains('ratchetStates')) {
        db.createObjectStore('ratchetStates', { keyPath: 'id' });
      }

      // Outbox store
      if (!db.objectStoreNames.contains('outbox')) {
        const outboxStore = db.createObjectStore('outbox', { keyPath: 'id' });
        outboxStore.createIndex('by-status', 'status');
        outboxStore.createIndex('by-conversation', 'conversationId');
      }

      // Message cache store
      if (!db.objectStoreNames.contains('messageCache')) {
        const messageCacheStore = db.createObjectStore('messageCache', {
          keyPath: 'id',
        });
        messageCacheStore.createIndex('by-conversation', 'conversationId');
        messageCacheStore.createIndex('by-timestamp', 'timestamp');
      }

      // Conversations store
      if (!db.objectStoreNames.contains('conversations')) {
        db.createObjectStore('conversations', { keyPath: 'id' });
      }

      // Identity keys store
      if (!db.objectStoreNames.contains('identityKeys')) {
        db.createObjectStore('identityKeys', { keyPath: 'userId' });
      }
    },
  });
}

/**
 * Get or throw if DB not initialized
 */
function getDB(): IDBPDatabase<CypherTextDB> {
  if (!db) {
    throw new Error('Storage not initialized. Call initStorage() first.');
  }
  return db;
}

// ========== Ratchet States ==========

export async function saveRatchetState(
  conversationId: string,
  deviceId: string,
  state: RatchetState
): Promise<void> {
  const { serializeRatchetState } = await import('../crypto/ratchet.js');
  const serialized = serializeRatchetState(state);

  await getDB().put('ratchetStates', {
    id: `${conversationId}:${deviceId}`,
    conversationId,
    deviceId,
    state: serialized,
    updatedAt: Date.now(),
  });
}

export async function getRatchetState(
  conversationId: string,
  deviceId: string
): Promise<RatchetState | null> {
  const record = await getDB().get('ratchetStates', `${conversationId}:${deviceId}`);

  if (!record) {
    return null;
  }

  const { deserializeRatchetState } = await import('../crypto/ratchet.js');
  return deserializeRatchetState(record.state);
}

export async function deleteRatchetState(
  conversationId: string,
  deviceId: string
): Promise<void> {
  await getDB().delete('ratchetStates', `${conversationId}:${deviceId}`);
}

// ========== Outbox ==========

export async function addToOutbox(message: {
  id: string;
  conversationId: string;
  recipientId: string;
  ciphertext: string;
}): Promise<void> {
  await getDB().add('outbox', {
    ...message,
    timestamp: Date.now(),
    attempts: 0,
    status: 'pending',
  });
}

export async function getPendingOutboxMessages(): Promise<
  Array<{
    id: string;
    conversationId: string;
    recipientId: string;
    ciphertext: string;
    timestamp: number;
    attempts: number;
  }>
> {
  const messages = await getDB().getAllFromIndex('outbox', 'by-status', 'pending');
  return messages;
}

export async function markOutboxSent(messageId: string): Promise<void> {
  const message = await getDB().get('outbox', messageId);
  if (message) {
    message.status = 'sent';
    await getDB().put('outbox', message);
  }
}

export async function incrementOutboxAttempts(messageId: string): Promise<void> {
  const message = await getDB().get('outbox', messageId);
  if (message) {
    message.attempts += 1;
    if (message.attempts >= 5) {
      message.status = 'failed';
    }
    await getDB().put('outbox', message);
  }
}

// ========== Message Cache ==========

export async function cacheMessage(message: {
  id: string;
  conversationId: string;
  senderId: string;
  plaintext: string;
  timestamp: number;
}): Promise<void> {
  await getDB().put('messageCache', {
    ...message,
    status: 'delivered',
  });
}

export async function getMessagesForConversation(
  conversationId: string,
  limit: number = 50
): Promise<
  Array<{
    id: string;
    senderId: string;
    plaintext: string;
    timestamp: number;
    status: 'delivered' | 'read';
  }>
> {
  const messages = await getDB().getAllFromIndex(
    'messageCache',
    'by-conversation',
    conversationId
  );

  return messages
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .reverse();
}

export async function markMessageAsRead(messageId: string): Promise<void> {
  const message = await getDB().get('messageCache', messageId);
  if (message) {
    message.status = 'read';
    await getDB().put('messageCache', message);
  }
}

// ========== Conversations ==========

export async function saveConversation(conversation: {
  id: string;
  type: 'direct' | 'group';
  participants: string[];
}): Promise<void> {
  const existing = await getDB().get('conversations', conversation.id);

  await getDB().put('conversations', {
    ...conversation,
    lastMessageAt: existing?.lastMessageAt || Date.now(),
    unreadCount: existing?.unreadCount || 0,
  });
}

export async function getAllConversations(): Promise<
  Array<{
    id: string;
    type: 'direct' | 'group';
    participants: string[];
    lastMessageAt: number;
    unreadCount: number;
  }>
> {
  const conversations = await getDB().getAll('conversations');
  return conversations.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export async function updateConversationLastMessage(
  conversationId: string
): Promise<void> {
  const conversation = await getDB().get('conversations', conversationId);
  if (conversation) {
    conversation.lastMessageAt = Date.now();
    await getDB().put('conversations', conversation);
  }
}

export async function incrementUnreadCount(conversationId: string): Promise<void> {
  const conversation = await getDB().get('conversations', conversationId);
  if (conversation) {
    conversation.unreadCount += 1;
    await getDB().put('conversations', conversation);
  }
}

export async function clearUnreadCount(conversationId: string): Promise<void> {
  const conversation = await getDB().get('conversations', conversationId);
  if (conversation) {
    conversation.unreadCount = 0;
    await getDB().put('conversations', conversation);
  }
}

// ========== Identity Keys ==========

export async function saveIdentityKeys(
  userId: string,
  publicKey: string,
  privateKey: string
): Promise<void> {
  await getDB().put('identityKeys', {
    userId,
    publicKey,
    privateKey,
    createdAt: Date.now(),
  });
}

export async function getIdentityKeys(
  userId: string
): Promise<{ publicKey: string; privateKey: string } | null> {
  const record = await getDB().get('identityKeys', userId);
  return record ? { publicKey: record.publicKey, privateKey: record.privateKey } : null;
}

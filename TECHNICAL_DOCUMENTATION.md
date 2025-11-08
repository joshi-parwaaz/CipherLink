# CipherLink - Technical Documentation

Comprehensive technical documentation of the CipherLink end-to-end encrypted messaging platform.

# CipherLink — Technical Documentation (Condensed)

This document summarizes the CipherLink architecture, encryption workflow (X3DH + Double Ratchet), message flow between frontend and backend, key modules, error handling/recovery, and deployment notes.

Contents
- Architecture overview
- Encryption workflow (X3DH + Double Ratchet)
- Frontend ↔ Backend message flow
- Key modules and purpose
- Error handling & recovery
- Setup & deployment summary
- Further reading (source file references)

---

## 1. Architecture overview

CipherLink is a zero-knowledge messaging system: the server transports encrypted envelopes only. Clients manage identity keys, prekeys and ratchet state locally. Key decisions:
- Client-side cryptography (libsodium)
- Per-device sessions (one ratchet state per conversation-device pair)
- WebSocket (Socket.IO) for real-time, HTTP polling as fallback
- MongoDB stores ciphertext envelopes plus minimal metadata (no private keys)

High-level components
- Frontend: React + TypeScript — key management, X3DH, Double Ratchet, UI
- Backend: Node.js + Express — prekey distribution, message storage, delivery fan-out
- Database: MongoDB (encrypted envelopes, prekey metadata, receipts)

---

## 2. Encryption workflow (X3DH + Double Ratchet)

X3DH: asynchronous session setup using signed prekeys and optional one-time prekeys.
 - Initiator (Alice) fetches recipient's prekey bundle, verifies signed prekey signature, generates ephemeral key and computes DHs, derives shared secret via HKDF, then sends first message containing ephemeral public key.
 - Responder (Bob) extracts ephemeral key from first message, computes matching DHs and derives the same shared secret.

Double Ratchet: after X3DH, both parties initialize ratchets with the shared secret and ratchet public keys.
 - Each message advances a symmetric chain producing a per-message key used with XChaCha20-Poly1305 AEAD.
 - Ratchet headers include sender ratchet public key and message number to support out-of-order handling.

Out-of-order messages
 - Ciphertext headers + skipped-key cache allow decryption of messages arriving out of order.
 - Max skipped keys configurable to limit memory.

Security primitives
 - Identity: Ed25519 (signing)
 - Agreement / Ratchet: X25519
 - AEAD: XChaCha20-Poly1305
 - KDF: HKDF (HMAC-SHA256)
 - Local key protection: Argon2id

---

## 3. Frontend ↔ Backend message flow

Send path (client):
1. Compose message → Messaging service encrypts using ratchet state
2. First outbound message may include X3DH ephemeral key in `x3dhData`
3. POST /api/messages (ciphertext envelope)
4. Backend stores envelope and attempts real-time fan-out to recipient devices via Socket.IO; if device offline, message marked pending

Receive path (client):
1. WebSocket `message:new` event (or polling GET /api/messages/pending/:deviceId)
2. Client parses header; if X3DH data present and no session, uses it to initialize Bob-side ratchet
3. Attempt decryption; on success send ACK (POST /api/messages/:id/ack)
4. On failure, client may attempt automatic session resync logic or report NACK for analysis

Server responsibilities
 - Store encrypted envelopes and minimal metadata
 - Maintain device list for fan-out
 - Mark delivered/failed via ACK/NACK endpoints

---

## 4. Key modules and their purpose

Frontend (src/)
- `crypto/` — X3DH, ratchet, AEAD, key serialization
- `services/messaging.ts` — session lifecycle, encrypt/decrypt pipeline, local persistence
- `services/realtime.ts` — Socket.IO wrapper and event handling
- `services/api.ts` — HTTP helpers, token injection
- `storage.ts` — safe localStorage wrappers and migration helpers

Backend (src/)
- `api/routes/*` — endpoints for auth, prekeys, messages, receipts
- `realtime/socket.ts` — device room management and emits
- `models/*` — Mongoose schemas for users/devices/messages
- `services/*` — prekey handling, delivery receipts, attachments

---

## 5. Error handling and recovery

Client:
- Decryption failures: increment local counter, attempt automatic resync (re-init X3DH if inbound X3DH present), limit retries and surface user-visible error if repeated
- Session corruption: verify session integrity at load, remove and trigger fresh X3DH initiation if unrecoverable

Server:
- Validation errors: 400 responses, logged
- Delivery: track pending messages and expose polling endpoint

Operational monitoring
- Structured logging server-side (Pino) and selective client-side diagnostics (tagged logs) to avoid sensitive data leakage

---

## 6. Setup & deployment summary

Local development
- Node.js v18+, MongoDB
- `backend`: `npm install && npm run dev`
- `frontend`: `npm install && npm run dev`

Production notes
- Serve frontend assets via CDN or static host; backend behind TLS with strict CORS
- Use managed MongoDB with auth and network restrictions
- Strong JWT secret and rotated prekeys; run dependency audits

---

## Further reading (source files)
- Frontend messaging: `frontend/src/services/messaging.ts`
- Crypto implementations: `frontend/src/crypto/x3dh.ts`, `frontend/src/crypto/ratchet.ts`, `frontend/src/crypto/aead.ts`
- Realtime: `frontend/src/services/realtime.ts`, `backend/src/realtime/socket.ts`
- Backend routes: `backend/src/api/routes/messages.routes.ts`, `backend/src/api/routes/prekeys.routes.ts`

---

Document maintained as a condensed reference. For full implementation details, consult the source files above.

*** End Patch
initializeRatchetAlice(x3dhSharedSecret, bobRatchetPublicKey)
  → Performs initial DH with Bob's ratchet key
  → Derives root key and sending chain

// Bob (responder)
initializeRatchetBob(x3dhSharedSecret, aliceRatchetPublicKey)
  → Receives Alice's ratchet key from first message
  → Derives same root key and receiving chain
```

#### Key Derivation Chains

**Root Chain** (DH Ratchet):
```
rootKey, chainKey = HKDF(rootKey, DH(ourRatchetKey, theirRatchetKey))
```

**Message Chain** (Symmetric Ratchet):
```
messageKey = HKDF(chainKey, 0x01)
chainKey' = HKDF(chainKey, 0x02)
```

**Per-Message Process**:
1. Derive message key from current chain key
2. Encrypt message with message key (AEAD)
3. Advance chain key (old chain key deleted)
4. Include ratchet public key and message number in header

#### Out-of-Order Message Handling

Messages may arrive out of order. The ratchet handles this by:
1. Storing skipped message keys (up to MAX_SKIP = 1000)
2. Key lookup: `"ratchetPublicKey:messageNumber" → messageKey`
3. Decrypt with stored key if available
4. Advance ratchet if this is the next expected message

### AEAD Encryption

**Implementation**: `frontend/src/crypto/aead.ts`

**Algorithm**: XChaCha20-Poly1305 (IETF variant)

**Why XChaCha20-Poly1305**:
- Extended nonce (24 bytes) reduces collision risk
- Fast, constant-time implementation
- Authenticated encryption (confidentiality + integrity)
- No padding oracle vulnerabilities

**Encryption Process**:
```typescript
encryptAEAD(plaintext, key, associatedData?) → { ciphertext, nonce }
```

**Associated Authenticated Data (AAD)**:
- senderId
- recipientIds (sorted for determinism)
- timestamp

AAD is NOT encrypted but IS authenticated (tampering detected).

**Decryption**:
```typescript
decryptAEAD({ ciphertext, nonce }, key, associatedData?) → plaintext
// Throws error if authentication fails
```

### Password-Based Key Encryption

**Implementation**: `frontend/src/crypto/passwordEncryption.ts`

Used for backing up identity private keys.

**Algorithm**: Argon2id (memory-hard KDF) + XChaCha20-Poly1305

**Process**:
```typescript
encryptPrivateKeyWithPassword(privateKey, password)
  1. Generate random salt (16 bytes)
  2. Derive 32-byte key: Argon2id(password, salt, ops=3, mem=64MB)
  3. Encrypt private key with derived key (XChaCha20-Poly1305)
  4. Return { encryptedKey, salt } (both base64)
```

**Decryption**:
```typescript
decryptPrivateKeyWithPassword(encryptedKey, salt, password)
  1. Derive same key from password + salt
  2. Decrypt with XChaCha20-Poly1305
  3. Return private key
```

**Security Properties**:
- Memory-hard (resistant to GPU/ASIC attacks)
- Salted (prevents rainbow tables)
- Parameterized for interactive use (balance security/UX)

---

## Backend Architecture

### Directory Structure

```
backend/
├── src/
│   ├── index.ts              # Entry point
│   ├── api/
│   │   ├── server.ts         # Express app setup
│   │   ├── middleware/
│   │   │   └── auth.ts       # JWT authentication
│   │   └── routes/
│   │       ├── auth.routes.ts      # Signup/signin
│   │       ├── devices.routes.ts   # Device management
│   │       ├── prekeys.routes.ts   # Prekey bundle API
│   │       ├── messages.routes.ts  # Message send/receive
│   │       ├── receipts.routes.ts  # Delivery receipts
│   │       └── conversations.routes.ts
│   ├── models/              # MongoDB schemas
│   │   ├── User.ts
│   │   ├── Device.ts
│   │   ├── Conversation.ts
│   │   ├── Message.ts
│   │   ├── DeliveryReceipt.ts
│   │   └── Attachment.ts
│   ├── services/            # Business logic
│   │   ├── tokens.service.ts
│   │   ├── receipts.service.ts
│   │   └── attachments.service.ts
│   ├── realtime/
│   │   └── socket.ts        # Socket.IO handlers
│   ├── config/
│   │   ├── index.ts         # Environment config
│   │   ├── mongo.ts         # MongoDB connection
│   │   ├── cors.ts          # CORS policy
│   │   └── rateLimit.ts     # Rate limiting
│   └── utils/
│       └── logger.ts        # Pino logger
└── package.json
```

### Authentication Flow

**JWT-Based Authentication**:

1. **Signup** (`POST /api/auth/signup`):
   ```
   Client sends:
   - username, password, identityPublicKey
   - encryptedIdentityPrivateKey (Argon2id-encrypted)
   - privateKeySalt, deviceId, deviceName
   
   Server:
   - Hashes password (bcrypt)
   - Stores encrypted private key (never decrypted server-side)
   - Generates JWT token
   - Returns: { userId, username, token }
   ```

2. **Signin** (`POST /api/auth/signin`):
   ```
   Client sends: username, password, deviceId
   Server:
   - Verifies password (bcrypt compare)
   - Generates JWT token
   - Returns: { userId, username, token, encryptedIdentityPrivateKey, privateKeySalt }
   ```

3. **Protected Routes**:
   ```typescript
   // Middleware: backend/src/api/middleware/auth.ts
   authenticate(req, res, next)
     - Extracts Bearer token from Authorization header
     - Verifies JWT signature
     - Attaches user info to req.user
   ```

### WebSocket (Socket.IO)

**Implementation**: `backend/src/realtime/socket.ts`

**Events**:

**Client → Server**:
```typescript
'register-device' → { userId, deviceId }
// Joins room for real-time message delivery
```

**Server → Client**:
```typescript
'message:new' → { messageId, convId, fromUserId, fromDeviceId, ciphertext, nonce, aad, ... }
'receipt:update' → { messageId, status, timestamp }
'conversation:request' → { convId, initiatorUsername, initiatorUserId }
'conversation:accepted' → { convId, acceptedByUsername }
```

**Room Strategy**:
- Each device joins room: `device:${deviceId}`
- Server emits to specific device: `io.to('device:xyz').emit('message:new', ...)`

### Message Delivery Pipeline

```
1. POST /api/messages
   ↓
2. Validate JWT auth
   ↓
3. Store encrypted envelope in MongoDB
   ↓
4. Fan-out to recipient devices:
   - Try WebSocket delivery (real-time)
   - If offline, message queued (status: pending)
   ↓
5. Recipient polling (GET /api/messages/pending/:deviceId)
   ↓
6. Acknowledgment (POST /api/messages/:messageId/ack)
   ↓
7. Mark delivered, create delivery receipt
```

---

## Frontend Architecture

### Directory Structure

```
frontend/
├── src/
│   ├── main.tsx             # Entry point
│   ├── app/
│   │   ├── App.tsx          # Root component with router
│   │   └── routes/
│   │       ├── Landing.tsx  # Landing page
│   │       ├── SignUp.tsx   # Registration
│   │       ├── SignIn.tsx   # Login
│   │       └── Chat.tsx     # Main chat interface
│   ├── components/
│   │   ├── ErrorBoundary.tsx
│   │   └── chat/
│   │       ├── ConversationList.tsx
│   │       ├── MessageList.tsx
│   │       └── MessageComposer.tsx
│   ├── crypto/              # Cryptographic primitives
│   │   ├── index.ts         # libsodium init
│   │   ├── keys.ts          # Key generation
│   │   ├── x3dh.ts          # X3DH protocol
│   │   ├── ratchet.ts       # Double Ratchet
│   │   ├── aead.ts          # AEAD encryption
│   │   └── passwordEncryption.ts
│   ├── services/
│   │   ├── api.ts           # HTTP client (axios)
│   │   ├── messaging.ts     # High-level messaging service
│   │   ├── realtime.ts      # Socket.IO client
│   │   └── storage.ts       # localStorage wrappers
│   ├── state/
│   │   └── messages.ts      # Message state management
│   ├── types/
│   │   └── message.ts       # TypeScript interfaces
│   └── styles/
│       └── index.css        # Tailwind imports
└── package.json
```

### Session Management

**Implementation**: `frontend/src/services/messaging.ts`

**Session Storage**:
```typescript
class MessagingService {
  private sessions: Map<conversationId, ConversationSession>
  
  interface ConversationSession {
    conversationId: string
    partnerId: string
    partnerUsername: string
    ratchetState: RatchetState    // Double Ratchet state
    x3dhEphemeralKey?: Uint8Array // For Alice's first message
    isInitiator: boolean
    createdAt: Date
    lastUsedAt: Date
  }
}
```

**Persistence**:
- Sessions serialized to localStorage: `session_${conversationId}`
- Ratchet state includes Uint8Array keys (converted to base64)
- Loaded on app init, validated for integrity

**Session Lifecycle**:
1. **Initialize** (Alice): X3DH → Double Ratchet → Store session
2. **First Message** (Alice): Include ephemeral key in header
3. **Receive First Message** (Bob): Extract ephemeral → X3DH respond → Initialize ratchet
4. **Ongoing**: Messages encrypted/decrypted with ratchet state
5. **Cleanup**: Invalid sessions removed on startup

### State Management

**Local State** (React useState):
- Component-level UI state
- Form inputs
- Modal visibility

**Global State** (localStorage):
- Authentication: userId, deviceId, authToken
- Keys: identityPublicKey, identityPrivateKey (encrypted), signedPreKeyPrivate
- Sessions: per-conversation ratchet state

**Message State**:
- In-memory: Current conversation messages
- Persistent: Not stored client-side (messages are stored on server as ciphertext)
- Load on demand: Fetch from server when conversation opened

---

## Protocol Flow

### Complete Flow: Alice sends first message to Bob

```
┌─────────┐                                    ┌─────────┐
│  Alice  │                                    │   Bob   │
└────┬────┘                                    └────┬────┘
     │                                              │
     │ 1. Fetch Bob's prekey bundle                │
     │────────────────────────────────────────────►│
     │     { IK_B, SPK_B, sig(SPK_B), OPK_B }     │
     │◄────────────────────────────────────────────│
     │                                              │
     │ 2. X3DH: 4 DH operations                    │
     │    Generate EK_A                             │
     │    Derive sharedSecret                       │
     │                                              │
     │ 3. Initialize Double Ratchet (Alice)        │
     │    rootKey = sharedSecret                   │
     │    Generate DH ratchet keypair              │
     │                                              │
     │ 4. Encrypt first message                    │
     │    messageKey = ratchet.encrypt()           │
     │    ciphertext = AEAD(plaintext, messageKey) │
     │                                              │
     │ 5. Send message with X3DH data              │
     │────────────────────────────────────────────►│
     │  { ciphertext, nonce, header: {             │
     │    ephemeralKey: EK_A,                      │
     │    ratchetPublicKey,                        │
     │    messageNumber: 0 }}                      │
     │                                              │
     │                        6. Extract EK_A       │
     │                           X3DH respond       │
     │                           Derive same secret │
     │                                              │
     │                        7. Initialize Ratchet │
     │                           (Bob) with EK_A    │
     │                                              │
     │                        8. Decrypt message    │
     │                           messageKey = ratchet│
     │                           plaintext = AEAD()  │
     │                                              │
     │ 9. Bob replies                               │
     │◄────────────────────────────────────────────│
     │    New ratchet DH step                      │
     │    Both sides advance chains                │
     │                                              │
     │ 10. Ongoing bidirectional messaging         │
     │◄───────────────────────────────────────────►│
     │    Each message uses new key from chain     │
     │    Old keys deleted (forward secrecy)       │
     │                                              │
```

---

## Data Models

### User

```typescript
interface IUser {
  username: string;                    // Unique username
  displayName: string;                 // Display name
  passwordHash: string;                // bcrypt hash
  identityPublicKey: string;           // Ed25519 public (hex)
  encryptedIdentityPrivateKey: string; // Argon2id-encrypted (base64)
  privateKeySalt: string;              // Salt for key derivation (base64)
  createdAt: Date;
  updatedAt: Date;
}
```

**MongoDB Collection**: `users`

### Device

```typescript
interface IDevice {
  userId: string;                   // Owner user ID
  deviceId: string;                 // Client-generated UUID
  deviceName: string;               // "iPhone 13", "Chrome on Windows"
  identityPublicKey: string;        // Copy of user's identity key
  registrationId: number;           // Random int for device identification
  signedPreKey: {
    keyId: number;
    publicKey: string;              // X25519 public (base64)
    signature: string;              // Ed25519 signature (base64)
  };
  oneTimePreKeys: Array<{
    keyId: number;
    publicKey: string;              // X25519 public (base64)
    used: boolean;                  // Consumption tracking
  }>;
  status: 'active' | 'inactive';
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

**MongoDB Collection**: `devices`

**Prekey Rotation**:
- Server marks one-time prekey as `used: true` when consumed
- Client periodically uploads new one-time prekeys
- Signed prekey rotated weekly (best practice)

### Conversation

```typescript
interface IConversation {
  convId: string;                   // UUID
  type: 'one_to_one' | 'group';
  memberUserIds: string[];          // User IDs in conversation
  memberDeviceIds: string[];        // All devices (for fan-out)
  status: 'pending' | 'accepted' | 'rejected';
  initiatorUserId: string;          // Who started the conversation
  groupName?: string;               // For group chats
  groupAdmins?: string[];           // Group admin user IDs
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

**MongoDB Collection**: `conversations`

### Message

```typescript
interface IMessage {
  messageId: string;                // UUID
  convId: string;                   // References Conversation
  fromUserId: string;
  fromDeviceId: string;
  toDeviceIds: string[];            // Fan-out list
  aad: {                            // Associated Authenticated Data
    senderId: string;
    recipientIds: string[];
    ts: Date;
  };
  nonce: string;                    // AEAD nonce (base64)
  ciphertext: string;               // Encrypted payload (base64)
  attachmentIds?: string[];         // Attachment references
  sentAt: Date;
  serverReceivedAt: Date;
  ttl?: Date;                       // Expiry time
  status: 'pending' | 'delivered' | 'failed';
  deliveredAt?: Date;
  messageNumber?: number;           // Ratchet message counter
}
```

**MongoDB Collection**: `messages`

**Indexes**:
- `{ messageId: 1 }` - unique
- `{ convId: 1, serverReceivedAt: -1 }` - conversation messages
- `{ toDeviceIds: 1, status: 1 }` - pending delivery queue
- `{ ttl: 1 }` - TTL index for auto-deletion

### DeliveryReceipt

```typescript
interface IDeliveryReceipt {
  messageId: string;
  deviceId: string;                 // Device that received
  userId: string;
  status: 'delivered' | 'read';
  timestamp: Date;
  createdAt: Date;
}
```

**MongoDB Collection**: `deliveryreceipts`

**Indexes**:
- `{ messageId: 1, deviceId: 1 }` - unique
- `{ userId: 1, status: 1 }`

### Attachment

```typescript
interface IAttachment {
  messageId: ObjectId;
  uploaderId: ObjectId;
  uploaderDeviceId: string;
  gridFsFileId: ObjectId;           // GridFS file reference
  encryptedMetadata: string;        // Encrypted filename, mimetype, size
  sizeBytes: number;
  uploadedAt: Date;
  expiresAt?: Date;
}
```

**MongoDB Collection**: `attachments`  
**File Storage**: GridFS bucket

---

## API Reference

### Authentication

#### POST /api/auth/signup
Register new user and device.

**Request**:
```json
{
  "username": "alice",
  "displayName": "Alice",
  "password": "securepassword",
  "identityPublicKey": "hex-encoded-ed25519-public",
  "encryptedIdentityPrivateKey": "base64-encrypted-private-key",
  "privateKeySalt": "base64-salt",
  "deviceId": "uuid-v4",
  "deviceName": "Chrome on Windows"
}
```

**Response** (200):
```json
{
  "userId": "uuid",
  "username": "alice",
  "token": "jwt-token",
  "deviceId": "uuid"
}
```

#### POST /api/auth/signin
Sign in existing user.

**Request**:
```json
{
  "username": "alice",
  "password": "securepassword",
  "deviceId": "uuid-v4"
}
```

**Response** (200):
```json
{
  "userId": "uuid",
  "username": "alice",
  "token": "jwt-token",
  "encryptedIdentityPrivateKey": "base64",
  "privateKeySalt": "base64"
}
```

### Prekeys

#### POST /api/prekeys/bundle
Upload prekey bundle for device.

**Auth**: Required (JWT)

**Request**:
```json
{
  "deviceId": "uuid",
  "identityPublicKey": "base64-ed25519-public",
  "registrationId": 12345,
  "signedPreKey": {
    "keyId": 1,
    "publicKey": "base64-x25519-public",
    "signature": "base64-ed25519-signature"
  },
  "oneTimePreKeys": [
    { "keyId": 1, "publicKey": "base64-x25519-public" },
    { "keyId": 2, "publicKey": "base64-x25519-public" }
  ]
}
```

**Response** (200):
```json
{
  "success": true,
  "prekeyCount": 2
}
```

#### GET /api/prekeys/bundle/:deviceId
Fetch prekey bundle for session initiation.

**Auth**: Required

**Response** (200):
```json
{
  "identityPublicKey": "base64",
  "registrationId": 12345,
  "signedPreKey": {
    "keyId": 1,
    "publicKey": "base64",
    "signature": "base64"
  },
  "oneTimePreKey": {
    "keyId": 5,
    "publicKey": "base64"
  }
}
```

**Note**: One-time prekey marked as `used: true` after this call.

### Messages

#### POST /api/messages
Send encrypted message.

**Auth**: Required

**Request**:
```json
{
  "convId": "uuid",
  "toDeviceIds": ["uuid-device-1", "uuid-device-2"],
  "aad": {
    "senderId": "uuid-user",
    "recipientIds": ["uuid-user-2"],
    "ts": "2025-11-06T12:00:00Z"
  },
  "nonce": "base64-24-bytes",
  "ciphertext": "base64-encrypted-payload",
  "x3dhData": {
    "ephemeralPublicKey": "base64-x25519-public",
    "usedOneTimePreKeyId": 5
  },
  "ratchetHeader": {
    "dhPublicKey": "base64-x25519-public",
    "messageNumber": 0,
    "previousChainLength": 0
  }
}
```

**Response** (201):
```json
{
  "messageId": "uuid",
  "serverReceivedAt": "2025-11-06T12:00:00.123Z"
}
```

#### GET /api/messages/pending/:deviceId
Fetch pending messages for device (polling).

**Auth**: Required

**Response** (200):
```json
{
  "messages": [
    {
      "messageId": "uuid",
      "convId": "uuid",
      "fromUserId": "uuid",
      "fromDeviceId": "uuid",
      "ciphertext": "base64",
      "nonce": "base64",
      "aad": { ... },
      "x3dhData": { ... },
      "ratchetHeader": { ... },
      "sentAt": "2025-11-06T12:00:00Z"
    }
  ]
}
```

#### POST /api/messages/:messageId/ack
Acknowledge message delivery.

**Auth**: Required

**Request**:
```json
{
  "status": "delivered"
}
```

**Response** (200):
```json
{
  "success": true
}
```

### Conversations

#### POST /api/conversations
Create conversation request.

**Auth**: Required

**Request**:
```json
{
  "convId": "uuid",
  "type": "one_to_one",
  "memberUserIds": ["uuid-1", "uuid-2"]
}
```

**Response** (201):
```json
{
  "convId": "uuid",
  "status": "pending"
}
```

#### PATCH /api/conversations/:convId/accept
Accept conversation request.

**Auth**: Required

**Response** (200):
```json
{
  "success": true,
  "conversation": { ... }
}
```

---

## Security Considerations

### Threat Model

**Assumptions**:
- Network attacker (passive eavesdropping)
- Compromised server (honest-but-curious)
- Client device compromise (post-compromise security)

**Out of Scope**:
- Client-side malware (compromised browser/OS)
- Physical device theft with unlocked screen
- Advanced persistent threats (APTs)

### Security Properties

#### Confidentiality
- ✅ **End-to-End Encryption**: Only sender and recipient can read messages
- ✅ **Zero-Knowledge Server**: Server has no access to plaintext
- ✅ **Forward Secrecy**: Compromising current keys doesn't reveal past messages
- ✅ **Post-Compromise Security**: Ratchet recovers from key compromise over time

#### Integrity
- ✅ **Authentication**: AEAD ensures messages haven't been tampered
- ✅ **Sender Authentication**: Identity keys verify sender identity
- ✅ **Replay Protection**: Nonces and message numbers prevent replay attacks

#### Availability
- ✅ **Offline Delivery**: Messages queued until recipient comes online
- ✅ **Multi-Device**: Sessions per device, not per user
- ⚠️ **Denial of Service**: Rate limiting provides basic protection (not DDoS-resistant)

### Known Limitations

1. **No Perfect Forward Secrecy for First Message**:
   - Signed prekeys are long-lived (rotated weekly)
   - Compromise of signed prekey + identity key reveals initial handshake
   - Mitigated by: One-time prekeys (single-use)

2. **Metadata Not Protected**:
   - Server knows: who talks to whom, when, message sizes
   - Does NOT know: message content
   - Future: Add padding, cover traffic

3. **No Deniability**:
   - Digital signatures prove sender identity
   - Trade-off: Authentication vs. Deniability
   - Signal has deniable authentication; we use simpler signatures

4. **localStorage Risks**:
   - Keys stored in browser localStorage (not as secure as OS keychain)
   - Vulnerable to XSS (mitigated by CSP, React's XSS protection)
   - Future: Use IndexedDB with encryption, or Web Crypto API

5. **No Backup/Recovery**:
   - Lost device = lost keys = lost conversations
   - Encrypted key backup exists but requires password
   - Future: Multi-device sync, secure backup to server

### Best Practices for Deployment

1. **HTTPS Only**: All connections must use TLS 1.3+
2. **Strong JWT Secret**: Use cryptographically random secret (32+ bytes)
3. **Secure MongoDB**: Authentication enabled, network isolation
4. **Rate Limiting**: Adjust limits based on usage patterns
5. **Security Headers**: CSP, HSTS, X-Frame-Options
6. **Regular Updates**: Keep dependencies updated (npm audit)
7. **Security Audit**: Professional cryptographic review before production
8. **Incident Response**: Plan for key compromise scenarios

---

## Performance Considerations

### Cryptography Performance

**libsodium** is highly optimized (constant-time implementations):
- X25519 DH: ~50,000 ops/sec
- XChaCha20-Poly1305: ~1 GB/s throughput
- Ed25519 signing: ~10,000 ops/sec
- Argon2id: ~100ms (by design, to resist brute-force)

**Bottlenecks**:
- Key derivation on login (Argon2id) - intentional UX delay
- Large file encryption - stream processing needed for 100MB+ files

### Database Performance

**Indexes** (already implemented):
- Message lookup by convId: O(log n)
- Pending message queue: O(log n) with `{ toDeviceIds, status }`
- User/device lookup: O(1) with unique indexes

**Scalability**:
- Current: Single MongoDB instance
- Future: Replica set (read scaling), sharding (write scaling)
- Message TTL: Auto-deletion keeps DB size bounded

### Network Optimization

**WebSocket** reduces latency:
- HTTP polling: ~3s delay
- WebSocket: <100ms delivery

**Message Batching**:
- Current: One HTTP request per message
- Future: Batch multiple messages in single request

---

## Testing

### Unit Tests

```bash
cd backend
npm test
```

**Coverage Areas**:
- Model validation (User, Device, Message schemas)
- API endpoints (auth, messages, prekeys)
- JWT token generation/verification

**To Add**:
- Crypto function tests (X3DH, Ratchet, AEAD)
- Frontend component tests (React Testing Library)
- End-to-end tests (Playwright)

### Manual Testing Checklist

- [ ] Alice signs up → Keys generated and encrypted
- [ ] Bob signs up → Prekeys uploaded
- [ ] Alice initiates conversation → X3DH succeeds
- [ ] Bob accepts → Session established
- [ ] Alice sends message → Bob receives (plaintext correct)
- [ ] Bob replies → Alice receives
- [ ] Multiple messages → Forward secrecy (different keys)
- [ ] Offline delivery → Message queued and delivered on reconnect
- [ ] Out-of-order messages → Skipped keys work
- [ ] Sign out → Keys persist (encrypted)
- [ ] Sign in → Keys restored

---

## Glossary

- **AEAD**: Authenticated Encryption with Associated Data
- **AAD**: Associated Authenticated Data (metadata authenticated but not encrypted)
- **DH**: Diffie-Hellman (key agreement protocol)
- **ECDH**: Elliptic Curve Diffie-Hellman
- **HKDF**: HMAC-based Key Derivation Function
- **IK**: Identity Key (long-term)
- **SPK**: Signed Prekey (medium-term)
- **OPK**: One-Time Prekey (single-use)
- **EK**: Ephemeral Key (session-specific)
- **X3DH**: Extended Triple Diffie-Hellman
- **KDF**: Key Derivation Function
- **JWT**: JSON Web Token
- **GridFS**: MongoDB's file storage system
- **libsodium**: NaCl cryptographic library

---

## References

- [Signal Protocol Specification](https://signal.org/docs/)
- [X3DH Specification](https://signal.org/docs/specifications/x3dh/)
- [Double Ratchet Algorithm](https://signal.org/docs/specifications/doubleratchet/)
- [libsodium Documentation](https://libsodium.gitbook.io/)
- [XChaCha20-Poly1305 RFC](https://tools.ietf.org/html/draft-irtf-cfrg-xchacha)
- [Argon2 Specification](https://github.com/P-H-C/phc-winner-argon2)

---

**Document Version**: 1.0  
**Last Updated**: November 6, 2025  
**Maintained by**: CipherLink Team

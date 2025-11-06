# CipherLink

**End-to-End Encrypted Chat Platform**

A secure, privacy-focused messaging application built with the MERN stack (MongoDB, Express, React, Node.js) featuring true end-to-end encryption using libsodium. The server has zero access to message content or encryption keys.

[![Tech Stack](https://img.shields.io/badge/Stack-MERN-green)]()
[![Encryption](https://img.shields.io/badge/Encryption-libsodium-blue)]()
[![Protocol](https://img.shields.io/badge/Protocol-X3DH%20%2B%20Double%20Ratchet-orange)]()

## 🔐 Security Features

- **Zero-Knowledge Architecture** - Server never sees plaintext messages or private keys
- **X3DH Key Agreement** - Signal Protocol-style session establishment
- **Double Ratchet** - Forward secrecy with per-message key rotation
- **XChaCha20-Poly1305 AEAD** - Authenticated encryption with associated data
- **Argon2id Key Derivation** - Password-based key encryption for backups
- **Multi-Device Support** - Per-device sessions with encrypted fan-out
- **Offline Message Delivery** - Server queues encrypted messages until delivery

## ✨ Features

### Core Functionality
- **1:1 Encrypted Messaging** - Private conversations between users
- **Real-time Delivery** - WebSocket + polling for instant message delivery
- **Conversation Requests** - Accept/reject conversation invitations
- **Read Receipts** - Delivered and read status tracking
- **Message Persistence** - Encrypted message storage with MongoDB
- **Attachment Support** - GridFS encrypted file storage (backend ready)

### Cryptography
- Ed25519 identity keys (signing)
- X25519 key agreement (Curve25519)
- Signed prekeys with signature verification
- One-time prekeys for forward secrecy
- HKDF-based key derivation
- Skipped message key handling (out-of-order delivery)

### Security
- JWT authentication
- Rate limiting
- CORS protection
- Password hashing (bcrypt)
- Client-side key encryption (Argon2id)
- No plaintext logging
- TTL-based message expiration

## 🚀 Quick Start

See [LOCAL_STARTUP.md](./LOCAL_STARTUP.md) for detailed installation and setup instructions.

### Prerequisites
- Node.js v18+
- MongoDB v6+
- npm or yarn

### Installation (Quick)
```bash
# Clone repository
git clone https://github.com/VertikaJain/react-chat-app.git
cd react-chat-app

# Install dependencies
npm install
cd frontend && npm install
cd ../backend && npm install

# Setup environment
cp backend/.env.example backend/.env
# Edit backend/.env with your MongoDB URI and JWT secret

# Start MongoDB (if not running)
mongod

# Start backend (from project root)
cd backend && npm run dev

# Start frontend (new terminal, from project root)
cd frontend && npm run dev
```

Visit `http://localhost:5173` and create two accounts to start messaging!

## 📚 Documentation

- **[Local Startup Guide](./LOCAL_STARTUP.md)** - Step-by-step setup instructions
- **[Technical Documentation](./TECHNICAL_DOCUMENTATION.md)** - Architecture and implementation details
- **[Verification Report](./VERIFICATION_REPORT.md)** - Feature compliance audit

## 🏗️ Architecture

```
┌─────────────────┐         ┌─────────────────┐
│  React Frontend │◄───────►│  Express API    │
│  (Port 5173)    │  HTTPS  │  (Port 5000)    │
└─────────────────┘         └─────────────────┘
        │                            │
        │ libsodium                  │
        │ X3DH + Ratchet             │
        │                            ▼
        │                   ┌─────────────────┐
        │                   │    MongoDB      │
        │                   │  (Ciphertext)   │
        │                   └─────────────────┘
        │
        ▼
┌─────────────────┐
│  localStorage   │
│  (Keys, Sessions)│
└─────────────────┘
```

### Tech Stack

**Frontend**
- React 18 + TypeScript
- Vite (build tool)
- TailwindCSS (styling)
- libsodium-wrappers (cryptography)
- Socket.io-client (real-time)

**Backend**
- Node.js + Express
- TypeScript
- MongoDB + Mongoose
- Socket.io (WebSocket)
- JWT authentication
- Pino (structured logging)

## 🔒 Cryptographic Protocol

1. **Registration** - User generates Ed25519 identity keys, encrypts private key with password (Argon2id)
2. **Prekey Upload** - Device uploads signed prekey + one-time prekeys to server
3. **Session Initiation** (Alice → Bob)
   - Alice fetches Bob's prekey bundle
   - Performs X3DH: 4 DH operations (IK, EK, IS, ES)
   - Derives shared secret via HKDF
   - Initializes Double Ratchet
4. **First Message** - Alice includes ephemeral key in message header
5. **Session Completion** (Bob)
   - Extracts ephemeral key from first message
   - Performs X3DH response
   - Initializes Double Ratchet (matching Alice's state)
6. **Message Exchange** - Each message uses new key from ratchet chain
7. **Forward Secrecy** - Old keys deleted after use

## 📂 Project Structure

```
CipherLink/
├── frontend/               # React application
│   ├── src/
│   │   ├── app/           # Routes and main App
│   │   ├── components/    # Reusable components
│   │   ├── crypto/        # Encryption implementation
│   │   │   ├── x3dh.ts           # X3DH protocol
│   │   │   ├── ratchet.ts        # Double Ratchet
│   │   │   ├── aead.ts           # AEAD encryption
│   │   │   ├── keys.ts           # Key generation
│   │   │   └── passwordEncryption.ts  # Argon2id
│   │   ├── services/      # API and messaging
│   │   └── styles/        # TailwindCSS
│   └── package.json
│
├── backend/               # Express server
│   ├── src/
│   │   ├── api/          # Routes and middleware
│   │   ├── models/       # MongoDB schemas
│   │   ├── services/     # Business logic
│   │   ├── config/       # Configuration
│   │   └── realtime/     # Socket.io handlers
│   └── package.json
│
├── specs/                # Project specification
└── README.md
```

## 🧪 Testing

```bash
# Backend tests
cd backend
npm test

# Frontend tests (if implemented)
cd frontend
npm test
```

## 🛣️ Roadmap

- [ ] Group chat UI implementation
- [ ] QR code / Safety number verification
- [ ] Device management UI
- [ ] File attachment UI
- [ ] Push notifications
- [ ] Desktop app (Electron)
- [ ] Mobile app (React Native)

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.

## 🔍 Security Considerations

This is an educational/prototype implementation. For production use:
- Professional security audit required
- Key backup and recovery mechanisms needed
- Rate limiting and abuse prevention
- Infrastructure hardening
- Compliance with data protection regulations

## 🙏 Acknowledgments

- [libsodium](https://libsodium.gitbook.io/) - Cryptographic primitives
- [Signal Protocol](https://signal.org/docs/) - X3DH and Double Ratchet inspiration
- MERN stack community

## 📧 Contact

Project maintained by [VertikaJain](https://github.com/VertikaJain)

---

**⚠️ Disclaimer**: This is a prototype implementation for educational purposes. Use at your own risk. For production applications, seek professional cryptographic review.

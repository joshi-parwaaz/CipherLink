# CipherLink

**End-to-End Encrypted Chat Platform**

A secure, privacy-focused messaging application built with the MERN stack (MongoDB, Express, React, Node.js) featuring true end-to-end encryption using libsodium. The server has zero access to message content or encryption keys.

[![Tech Stack](https://img.shields.io/badge/Stack-MERN-green)]()
[![Encryption](https://img.shields.io/badge/Encryption-libsodium-blue)]()
[![Protocol](https://img.shields.io/badge/Protocol-X3DH%20%2B%20Double%20Ratchet-orange)]()

## 🔐 Security Features
*** End Patch
*** Begin Patch
*** Add File: /d:\Work\code\CipherLink\README.md
+# CipherLink 🔒
A compact end-to-end encrypted real-time messaging prototype built with React, Node.js and libsodium. CipherLink demonstrates X3DH + Double Ratchet for private one-to-one messaging with per-device sessions and secure offline delivery.

## Key features
- X3DH + Double Ratchet end-to-end encryption
- Real-time delivery (WebSocket) with polling fallback
- Per-device sessions & one-time prekeys for async init
- Secure client-side key storage (Argon2id-encrypted)
- Automatic session resync and decryption recovery
- Message delivery receipts and offline queuing

## Stack
- Frontend: React 18 + TypeScript, Vite, Tailwind
- Backend: Node.js + Express, TypeScript, MongoDB (Mongoose)
- Crypto: libsodium-wrappers (X25519 / Ed25519 / XChaCha20-Poly1305)

## Quickstart
Clone, install, run backend and frontend locally.

```powershell
git clone <repo-url>
cd CipherLink
npm install
cd frontend; npm install; cd ../backend; npm install

# copy example env and edit values
cp .env.example backend/.env

# start backend (in one terminal)
cd backend; npm run dev

# start frontend (in another terminal)
cd ../frontend; npm run dev

# open http://localhost:5173
```

How to build and test

```powershell
# Backend tests
cd backend; npm test

# Frontend build
cd frontend; npm run build

# TypeScript check
cd .; npx tsc --noEmit

# Lint / format (optional)
npm run lint -- --fix
npm run format
```

## Contact & License
MIT © CipherLink

Maintainer: Project repository owner

---
Small, focused README intended for GitHub; see `TECHNICAL_DOCUMENTATION.md` for implementation and protocol details.

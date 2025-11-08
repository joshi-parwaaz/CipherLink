 # CypherText Constitution

 ## Core Principles

 ### I. Zero-Access Architecture

 - CypherText’s backend must have zero knowledge of message content, keys, or plaintext data.
 - The server acts only as a delivery relay and metadata store.
 - No plaintext, no session keys, and no user secrets may ever be transmitted or stored server-side.
 - MongoDB collections must contain ciphertext envelopes, delivery receipts, and timestamps only.
 - All plaintext processing must occur exclusively within user devices.

 ### II. Client-Side Encryption First

 - Every message, attachment, and key exchange must originate and terminate encrypted on the client.
 - All encryption, decryption, signing, and verification are performed locally using `libsodium`.
 - Clients manage their own identity (`Ed25519` signing) and device (`Curve25519/X25519` agreement) key pairs.
 - Local key material is securely stored in encrypted local storage; device add/rotate/revoke flows are mandatory.
 - Attachments are encrypted client-side with streaming AEAD and uploaded as encrypted blobs.

 ### III. Forward Secrecy and Trustless Sessions

 - CypherText must guarantee that compromise of any device or key does not reveal past communications.
 - Implement `Double Ratchet`-style key evolution via `HKDF` chains for per-message symmetric keys.
 - Sessions are established using `X3DH` handshakes with signed and one-time prekeys.
 - Users verify identity safety via QR codes or numeric safety codes to prevent MITM.
 - Each device maintains its own ratchet and session state; session resync must handle offline message queues safely.

 ### IV. Integrity, Authentication & Observability (Meta Only)

 - The system must authenticate data while preserving absolute privacy.
 - All messages use AEAD `XChaCha20-Poly1305` with associated data (`senderId`, `recipientId`, `timestamp`).
 - Integrity checks are mandatory before message decryption.
 - Observability is meta-only: structured logs for queue depth, delivery latency, and failures using correlation IDs.
 - Logs may never include plaintext, ciphertext contents, or user metadata beyond IDs and timestamps.

 ### V. Transparency, Simplicity, and Crypto Hygiene

 - The codebase must prioritize auditability, simplicity, and cryptographic correctness.
 - All encryption/decryption and ratchet mechanisms require reproducible test vectors.
 - Constant-time comparisons must be used wherever applicable.
 - Include fuzz and malformed-packet tests for session recovery and nonce handling.
 - Any new feature must not expand attack surface or introduce unnecessary complexity.
 - Follow the principle: _Privacy by Design, Simplicity by Implementation_.

 ## Security & Functional Requirements

 ### 1. Identity & Device Management

 - Each user has a persistent identity keypair (`Ed25519`) for signing and verification.
 - Each device generates its own `Curve25519 (X25519)` keypair for key exchange.
 - Devices can be added, rotated, or revoked via a secure client flow with cross-verification.
 - Device lists must be synchronized and cryptographically signed per user.

 ### 2. Session Establishment (`X3DH`)

 - On first contact, devices perform an `X3DH` handshake using prekeys retrieved from the server.
 - Derived secrets feed into the `Double Ratchet` key evolution.
 - All session state transitions must be deterministic and logged client-side for debugging.

 ### 3. Message Encryption & Forward Secrecy

 - Each message uses a unique symmetric key derived from a ratchet step.
 - Encryption uses `crypto_aead_xchacha20poly1305_ietf` with metadata as AAD.
 - Servers store ciphertext envelopes with minimal metadata (message ID, sender ID, recipient ID, timestamp).

 ### 4. Attachments

 - Client encrypts files with a random key and nonce using streaming encryption.
 - Only encrypted chunks and a content hash are uploaded.
 - The server provides range-safe download endpoints.

 ### 5. Offline Delivery

 - When recipients are offline, messages queue on the server encrypted.
 - Upon delivery confirmation, the message is deleted from server storage.
 - Implement idempotent delivery, read receipts, and out-of-order handling.

 ### 6. Multi-Device & Group Support

 - Each device maintains independent sessions with each peer device.
 - Messages fan out to all verified devices of the recipient.
 - Group messages (optional) use sender keys or pairwise fan-out with a deterministic member list in AAD.

 ### 7. Authentication & Access Control

 - Use `JWT` tokens for app session authentication.
 - Enforce strict CORS, rate limiting, replay protection, and TTL-based metadata expiry.
 - Absolutely no plaintext logs or unencrypted request dumps.

 ### 8. Observability & Logging

 - Track delivery queue depth, latency, and failure rates using structured logs.
 - All logs and metrics exclude any plaintext or ciphertext payloads.
 - Correlation IDs are required for tracing.

 ## Development Workflow & Quality Standards

 ### Test-First Implementation (Mandatory)

 - Write crypto test vectors and failure cases before implementing logic.
 - Include unit tests for encrypt/decrypt, nonce reuse detection, and ratchet consistency.

 ### Code Review & Security Gate

 - Every PR must be reviewed by at least one security reviewer.
 - Any code touching encryption, key management, or authentication must undergo manual verification.

 ### Audit & Verification

 Each release must pass an internal audit for:

 - Zero plaintext exposure
 - Proper key deletion
 - Correct use of `libsodium` primitives

 Any change to encryption or session protocol requires re-derivation of test vectors.

 ### Deployment & Privacy Enforcement

 - Backend must undergo privacy linting (check for any accidental logging of plaintext or secrets).
 - MongoDB collections must use TTL indexes for ephemeral data cleanup.

 ## Governance

 - This constitution defines CypherText’s non-negotiable architectural principles.
 - Any modification to encryption primitives, trust boundaries, or key handling requires a formal amendment with rationale, migration strategy, and review approval.
 - New contributors must read this constitution before contributing to ensure architectural alignment.
 - All pull requests must demonstrate compliance via tests or architecture notes.
 - Violations (such as plaintext handling or key misuse) trigger a mandatory code freeze until resolved.

 ---

 | Version | Ratified    | Last amended |
 |:-------:|:-----------:|:------------:|
 | 1.0.0   | 2025-11-04  | 2025-11-04   |
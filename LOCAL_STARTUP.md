
# CipherLink - Local Startup Guide

## Note on Meta/Config Folders

- `.github/` – GitHub Actions, Copilot, and workflow configuration (ignored in .gitignore)
- `.specify/` – Internal feature planning, scripts, and templates (ignored in .gitignore)
- `.vscode/` – VS Code workspace settings (ignored in .gitignore except settings.json)

These folders are ignored in version control for privacy and repo cleanliness.

Complete step-by-step instructions to get CipherLink running on your local machine.

## Prerequisites

Before you begin, ensure you have the following installed:

### Required Software

1. **Node.js** (v18 or higher)
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify installation: `node --version`

2. **MongoDB** (v6 or higher)
   - **Option A - Local Installation**:
     - Download from [mongodb.com](https://www.mongodb.com/try/download/community)
     - Follow installation instructions for your OS
   - **Option B - Docker**:
     ```bash
     docker run -d -p 27017:27017 --name mongodb mongo:latest
     ```
   - Verify MongoDB is running: `mongosh` or check port 27017

3. **Git**
   - Download from [git-scm.com](https://git-scm.com/)
   - Verify: `git --version`

### Optional Tools
- **MongoDB Compass** - GUI for MongoDB (recommended for viewing data)
- **Postman** or **Thunder Client** - API testing

---

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/VertikaJain/react-chat-app.git
cd react-chat-app
```

### 2. Install Backend Dependencies

```bash
cd backend
npm install
```

**Expected packages** (auto-installed):
- express, mongoose, socket.io
- jsonwebtoken, bcrypt
- cors, express-rate-limit
- pino (logging)
- TypeScript and dev dependencies

### 3. Install Frontend Dependencies

```bash
cd ../frontend
npm install
```

**Expected packages**:
- react, react-dom, react-router-dom
- libsodium-wrappers (cryptography)
- socket.io-client
- axios
- tailwindcss
- TypeScript and Vite

### 4. Configure Environment Variables

Create backend environment file:
```bash
cd ../backend
cp .env.example .env
```

Edit `backend/.env` with your settings:
```env
# Server Configuration
PORT=5000
NODE_ENV=development

# MongoDB Connection
MONGO_URI=mongodb://localhost:27017/cipherlink

# JWT Secret (change this!)
JWT_SECRET=your-super-secret-jwt-key-change-me-in-production

# CORS Origin (frontend URL)
CORS_ORIGIN=http://localhost:5173

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

**⚠️ Important**: Change `JWT_SECRET` to a random string in production!

Generate a secure JWT secret:
```bash
# On Linux/Mac
openssl rand -base64 32

# On Windows (PowerShell)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

---

## Starting the Application

### Option 1: Using Separate Terminals (Recommended)

#### Terminal 1 - Backend
```bash
cd backend
npm run dev
```

**Expected output**:
```
[timestamp] INFO: Server listening on port 5000
[timestamp] INFO: MongoDB connected successfully
[timestamp] INFO: GridFS bucket initialized
[timestamp] INFO: Socket.IO initialized
```

#### Terminal 2 - Frontend
```bash
cd frontend
npm run dev
```

**Expected output**:
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

### Option 2: Using a Process Manager

Install `concurrently` (from project root):
```bash
npm install -g concurrently
```

Create a start script in project root `package.json`:
```json
{
  "scripts": {
    "start": "concurrently \"cd backend && npm run dev\" \"cd frontend && npm run dev\""
  }
}
```

Then run:
```bash
npm start
```

---

## Verifying Installation

### 1. Check Backend Health

Open browser or use curl:
```bash
curl http://localhost:5000/api/health
```

**Expected response**:
```json
{
  "status": "ok",
  "timestamp": "2025-11-06T..."
}
```

### 2. Check MongoDB Connection

Using MongoDB Compass:
- Connect to: `mongodb://localhost:27017`
- Database `cipherlink` should appear after first signup

Using mongosh:
```bash
mongosh
use cipherlink
show collections
```

### 3. Access Frontend

1. Open browser: `http://localhost:5173`
2. You should see the CipherLink landing/login page

---

## First Time Usage

### Create Test Accounts

To test messaging, you need **two users**:

#### User 1 (Alice)
1. Go to `http://localhost:5173`
2. Click "Sign Up"
3. Username: `alice`
4. Display Name: `Alice`
5. Password: `test123` (or your choice)
6. Click "Sign Up"

**What happens**:
- Ed25519 identity keys generated client-side
- Private key encrypted with password (Argon2id)
- Signed prekeys and one-time prekeys uploaded to server
- JWT token received and stored

#### User 2 (Bob)
1. **Open a new incognito/private window** (or different browser)
2. Go to `http://localhost:5173`
3. Sign up with:
   - Username: `bob`
   - Display Name: `Bob`
   - Password: `test123`

### Start a Conversation

#### From Alice's Window:
1. After login, you'll see the Chat page
2. In the search box, type: `bob`
3. Click "Start Conversation" next to Bob's name
4. Wait for Bob to accept

#### From Bob's Window:
1. You should see a notification: "New conversation request from alice"
2. Click the "Requests" tab
3. Click "Accept" next to Alice's request

#### Send Messages:
- Alice can now type a message and click "Send"
- Bob receives it in real-time
- Both can send messages back and forth

### Message History / Reload behavior

- The client now fetches encrypted conversation history from the backend and decrypts it locally on chat initialization. This means that after a refresh, previously delivered messages will reappear if the local ratchet/session state is present.
- If you cleared browser localStorage (sessions and keys) the client will not be able to decrypt history — use the `cipherlink` debug utilities to inspect or clear sessions.

### Helpful dev utilities

- In the browser console (development builds) you have `cipherlink` helpers:
  - `cipherlink.showSessions()` – list stored sessions and ratchet info
  - `cipherlink.clearSessions()` – removes session objects from localStorage
  - `cipherlink.stats()` – fetches server-side message counts per session for debugging
  - `cipherlink.version()` – show storage version

These are intended for development/debugging only.

---

## Troubleshooting

### Backend Won't Start

**Error**: `EADDRINUSE: address already in use :::5000`
- **Solution**: Another process is using port 5000
  ```bash
  # On Linux/Mac
  lsof -i :5000
  kill -9 <PID>
  
  # On Windows
  netstat -ano | findstr :5000
  taskkill /PID <PID> /F
  ```

**Error**: `MongooseError: connect ECONNREFUSED`
- **Solution**: MongoDB is not running
  ```bash
  # Start MongoDB service
  # Linux: sudo systemctl start mongod
  # Mac: brew services start mongodb-community
  # Windows: Start MongoDB service from Services
  # Docker: docker start mongodb
  ```

### Frontend Build Errors

**Error**: `Module not found: libsodium-wrappers`
- **Solution**: Reinstall dependencies
  ```bash
  cd frontend
  rm -rf node_modules package-lock.json
  npm install
  ```

**Error**: `Failed to resolve import "react"`
- **Solution**: Ensure React is installed
  ```bash
  npm install react react-dom
  ```

### Messages Not Sending

**Check browser console** (F12):
- Look for WebSocket connection errors
- Check for crypto initialization errors

**Check backend logs**:
- Should see `Socket.IO connected` when frontend connects
- Look for `POST /api/messages` requests

**Common fixes**:
1. Clear localStorage: Open DevTools → Application → Local Storage → Clear All
2. Sign out and sign in again
3. Restart both frontend and backend

### Clear Everything and Start Fresh

```bash
# Stop all servers

# Clear MongoDB
mongosh
use cipherlink
db.dropDatabase()
exit

# Clear browser localStorage
# In browser DevTools: Application → Local Storage → Clear All

# Restart servers
cd backend && npm run dev
cd frontend && npm run dev

# Sign up fresh users
```

---

## Development Tools

### View Logs

**Backend logs** (pino format):
```bash
cd backend
npm run dev | pino-pretty
```

**Frontend console**:
- Press F12 in browser
- Check Console tab for errors/warnings

### MongoDB GUI

**MongoDB Compass**:
1. Open MongoDB Compass
2. Connect to `mongodb://localhost:27017`
3. Browse `cipherlink` database
4. View collections: users, devices, conversations, messages

**View encrypted messages**:
```bash
mongosh
use cipherlink
db.messages.find().pretty()
```

You'll see only ciphertext - no plaintext! 🔐

### API Testing

**Test signup endpoint**:
```bash
curl -X POST http://localhost:5000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "displayName": "Test User",
    "password": "test123",
    "identityPublicKey": "...",
    "encryptedIdentityPrivateKey": "...",
    "privateKeySalt": "...",
    "deviceId": "test-device",
    "deviceName": "Test Device"
  }'
```

---

## Production Deployment

For production deployment, see:
- **Deployment Guide** (coming soon)
- Configure production MongoDB (Atlas recommended)
- Use HTTPS/TLS
- Set strong JWT_SECRET
- Enable production logging
- Set NODE_ENV=production
- Configure rate limits
- Use process manager (PM2)

---

## Need Help?

- **Issues**: Open an issue on [GitHub](https://github.com/VertikaJain/react-chat-app/issues)
- **Discussions**: Join GitHub Discussions
- **Documentation**: See [TECHNICAL_DOCUMENTATION.md](./TECHNICAL_DOCUMENTATION.md)

---

## Next Steps

After successful setup:
1. ✅ Try sending messages between Alice and Bob
2. ✅ Check MongoDB to verify only ciphertext is stored
3. ✅ Try signing in from multiple devices
4. ✅ Test offline message delivery (disconnect network, send message, reconnect)
5. 📖 Read [TECHNICAL_DOCUMENTATION.md](./TECHNICAL_DOCUMENTATION.md) to understand the crypto

**Happy secure messaging! 🔐**

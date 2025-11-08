# Localhost Setup

Quick steps to run CipherLink locally for development.

1. Install dependencies

```powershell
npm install
cd frontend; npm install; cd ../backend; npm install
```

2. Configure environment

```powershell
cp .env.example backend/.env
# edit backend/.env to set MONGODB_URI and JWT_SECRET
```

3. Start backend (terminal A)

```powershell
cd backend
npm run dev
```

4. Start frontend (terminal B)

```powershell
cd frontend
npm run dev
```

5. Visit

http://localhost:5173

Optional:
- Run the validation script: `node validation-script.js`
- Run backend tests: `cd backend && npm test`

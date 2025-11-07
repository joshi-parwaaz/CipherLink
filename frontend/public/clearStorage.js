// Clear all CipherLink data from browser storage
// Run this in browser console to reset everything

console.log('🧹 Clearing CipherLink storage...');

// Get all keys
const keys = Object.keys(localStorage);
let cleared = 0;

// Remove all CipherLink-related data
keys.forEach(key => {
  if (
    key.startsWith('session_') ||
    key === 'userId' ||
    key === 'username' ||
    key === 'deviceId' ||
    key === 'authToken' ||
    key === 'identityPublicKey' ||
    key === 'identityPrivateKey' ||
    key === 'encryptedIdentityPrivateKey' ||
    key === 'privateKeySalt' ||
    key === 'signedPreKeyPrivate' ||
    key === 'signedPreKeyPublic' ||
    key.includes('prekey') ||
    key.includes('ratchet')
  ) {
    localStorage.removeItem(key);
    cleared++;
    console.log(`   ✓ Removed: ${key}`);
  }
});

console.log(`\n✅ Cleared ${cleared} items from localStorage`);
console.log('🔄 Please refresh the page and sign in again');

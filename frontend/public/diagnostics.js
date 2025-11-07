// Quick diagnostic to check message delivery
// Run this in browser console when testing

console.log('=== CIPHERLINK DIAGNOSTICS ===');

// Check WebSocket connection
console.log('\n1. WebSocket Status:');
console.log('   Connected:', window.realtimeClient?.isConnected?.() || 'Unable to check');

// Check localStorage
console.log('\n2. LocalStorage State:');
console.log('   userId:', localStorage.getItem('userId'));
console.log('   deviceId:', localStorage.getItem('deviceId'));
console.log('   authToken:', localStorage.getItem('authToken') ? 'Present' : 'Missing');

// Check sessions
console.log('\n3. Sessions:');
const sessionKeys = Object.keys(localStorage).filter(k => k.startsWith('session_'));
console.log('   Active sessions:', sessionKeys.length);
sessionKeys.forEach(key => {
  try {
    const session = JSON.parse(localStorage.getItem(key));
    console.log(`   - ${key}:`, {
      conversationId: session.conversationId,
      partner: session.partnerUsername,
      isInitiator: session.isInitiator
    });
  } catch(e) {
    console.log(`   - ${key}: Invalid JSON`);
  }
});

console.log('\n=== END DIAGNOSTICS ===');
console.log('To test message delivery:');
console.log('1. Open this page in two browsers (Alice and Bob)');
console.log('2. Make sure both show "Connected: true"');
console.log('3. Check Network tab for WebSocket connection');
console.log('4. Send a message and watch browser console for events');

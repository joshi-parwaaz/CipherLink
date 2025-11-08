const http = require('http');

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (chunks += d));
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body: chunks });
        });
      }
    );
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

(async () => {
  try {
    const username = `auto_user_${Date.now()}`;
    const deviceId = '00000000-0000-4000-8000-000000000001';
    const registerPayload = {
      username,
      displayName: 'Auto Test',
      password: 'Password123!',
      identityPublicKey: 'deadbeef',
      encryptedIdentityPrivateKey: 'encpriv',
      privateKeySalt: 'salt',
      encryptedSignedPreKeyPrivate: 'encsp',
      signedPreKeySalt: 'spsalt',
      deviceId,
      deviceName: 'auto-device',
      signedPreKey: 'signedprekey',
      signedPreKeySignature: 'signature',
      oneTimePreKeys: [],
    };

  // register user (silent)
  const reg = await post('/api/auth/register', registerPayload);

  // login (silent)
  const login = await post('/api/auth/login', { username, password: 'Password123!' });
  } catch (err) {
    console.error('Error', err);
    process.exit(1);
  }
})();

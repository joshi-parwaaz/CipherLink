import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import MatrixRain from '../../components/common/MatrixRain';
import { apiClient } from '../../services/api';
import { initCrypto } from '../../crypto';
import { generateIdentityKeyPair, generateX25519KeyPair, signMessage } from '../../crypto/keys';
import { encryptPrivateKeyWithPassword } from '../../crypto/passwordEncryption';
import { sodium } from '../../crypto';

export default function SignUp() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate inputs
      if (!username || !displayName || !password) {
        setError('All fields are required');
        setLoading(false);
        return;
      }

      if (username.length < 3) {
        setError('Username must be at least 3 characters');
        setLoading(false);
        return;
      }

      if (password.length < 8) {
        setError('Password must be at least 8 characters');
        setLoading(false);
        return;
      }

      // Initialize crypto
      await initCrypto();

      // Generate identity keypair (Ed25519 for signing)
      const identityKeyPair = generateIdentityKeyPair();

      // Generate device ID (UUID v4 format)
      const deviceId = crypto.randomUUID();
      const deviceName = `${navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'} Browser`;

      // Generate signed prekey (X25519 for key agreement)
      const signedPreKeyPair = generateX25519KeyPair();
      
      // Sign the prekey with identity key
      const signedPreKeySignature = signMessage(signedPreKeyPair.publicKey, identityKeyPair.privateKey);

      // Generate one-time prekeys (10 keys)
      const oneTimePreKeys: string[] = [];
      for (let i = 0; i < 10; i++) {
        const preKeyPair = generateX25519KeyPair();
        oneTimePreKeys.push(sodium.to_base64(preKeyPair.publicKey));
      }

      // Convert keys to base64/hex
      const publicKeyBase64 = identityKeyPair.publicKeyHex;
      const privateKeyBase64 = identityKeyPair.privateKeyHex;
      const signedPreKeyBase64 = sodium.to_base64(signedPreKeyPair.publicKey);
      const signedPreKeyPrivateBase64 = sodium.to_base64(signedPreKeyPair.privateKey);
      const signatureBase64 = sodium.to_base64(signedPreKeySignature);

      // Encrypt private key with password for server backup
      const { encryptedKey, salt } = encryptPrivateKeyWithPassword(
        identityKeyPair.privateKey,
        password
      );

      // Encrypt signedPreKey private with password for server backup
      const { encryptedKey: encryptedSignedPreKey, salt: signedPreKeySalt } = encryptPrivateKeyWithPassword(
        signedPreKeyPair.privateKey,
        password
      );
      // Register user
      const response = await apiClient.register({
        username,
        displayName,
        password,
        identityPublicKey: publicKeyBase64,
        encryptedIdentityPrivateKey: encryptedKey,
        privateKeySalt: salt,
        encryptedSignedPreKeyPrivate: encryptedSignedPreKey,
        signedPreKeySalt: signedPreKeySalt,
        deviceId,
        deviceName,
        signedPreKey: signedPreKeyBase64,
        signedPreKeySignature: signatureBase64,
        oneTimePreKeys,
      });
      // Store auth token
      localStorage.setItem('authToken', response.token);
      
      // Set token in API client for authenticated requests
      apiClient.setToken(response.token);

      // Store identity keypair and device info
      localStorage.setItem('identityPrivateKey', privateKeyBase64);
      localStorage.setItem('identityPublicKey', publicKeyBase64);
      localStorage.setItem('userId', response.user.id);
      localStorage.setItem('deviceId', deviceId);
      localStorage.setItem('signedPreKeyPrivate', signedPreKeyPrivateBase64);
      localStorage.setItem('signedPreKeyPublic', signedPreKeyBase64);

      // Navigate to chat
      navigate('/chat');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create account. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-black text-white flex items-center justify-center">
      {/* Matrix rain background */}
      <MatrixRain />

      {/* Sign up form */}
      <div className="relative z-10 bg-gray-900 bg-opacity-90 p-8 rounded-lg shadow-2xl max-w-md w-full border border-green-500 border-opacity-30">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-green-400 mb-2">CipherLink</h1>
          <h2 className="text-xl text-gray-300">Create Account</h2>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900 bg-opacity-50 border border-red-500 rounded text-red-200 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block mb-2 text-green-300">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full p-3 rounded bg-gray-800 text-white border border-gray-700 focus:border-green-500 focus:outline-none"
              placeholder="Choose a username"
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="mb-4">
            <label className="block mb-2 text-green-300">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full p-3 rounded bg-gray-800 text-white border border-gray-700 focus:border-green-500 focus:outline-none"
              placeholder="How others will see you"
              disabled={loading}
            />
          </div>

          <div className="mb-6">
            <label className="block mb-2 text-green-300">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 rounded bg-gray-800 text-white border border-gray-700 focus:border-green-500 focus:outline-none"
              placeholder="At least 8 characters"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-green-600 rounded hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed font-semibold transition-colors"
          >
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 text-center text-gray-400">
          <p>
            Already have an account?{' '}
            <Link to="/signin" className="text-green-400 hover:text-green-300">
              Sign In
            </Link>
          </p>
        </div>

        <div className="mt-4 text-center text-gray-400">
          <Link to="/" className="text-green-400 hover:text-green-300 inline-flex items-center gap-1">
            <span>←</span> Back to Home
          </Link>
        </div>

        <div className="mt-4 text-center text-xs text-gray-500">
          🔒 End-to-end encrypted • Zero-access architecture
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import MatrixRain from '../../components/common/MatrixRain';
import { apiClient } from '../../services/api';
import { initCrypto } from '../../crypto';
import { decryptPrivateKeyWithPassword } from '../../crypto/passwordEncryption';
import { sodium } from '../../crypto';

export default function SignIn() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate inputs
      if (!username || !password) {
        setError('Username and password are required');
        setLoading(false);
        return;
      }

      // Initialize crypto
      await initCrypto();

      // Login to get encrypted private key from server
      const response = await apiClient.login({
        username,
        password,
      });

      // Decrypt identity private key using password
      const identityPrivateKey = decryptPrivateKeyWithPassword(
        response.user.encryptedIdentityPrivateKey,
        response.user.privateKeySalt,
        password
      );

      // Store decrypted keys in localStorage
      const privateKeyHex = sodium.to_hex(identityPrivateKey);
      const publicKeyHex = response.user.identityPublicKey;

      localStorage.setItem('identityPrivateKey', privateKeyHex);
      localStorage.setItem('identityPublicKey', publicKeyHex);

      // Decrypt and store signedPreKey private if available
      if (response.user.encryptedSignedPreKeyPrivate && response.user.signedPreKeySalt) {
        const signedPreKeyPrivate = decryptPrivateKeyWithPassword(
          response.user.encryptedSignedPreKeyPrivate,
          response.user.signedPreKeySalt,
          password
        );
        const signedPreKeyPrivateBase64 = sodium.to_base64(signedPreKeyPrivate);
        localStorage.setItem('signedPreKeyPrivate', signedPreKeyPrivateBase64);
      }

      // Store signedPreKey public if available
      if (response.signedPreKeyPublic) {
        localStorage.setItem('signedPreKeyPublic', response.signedPreKeyPublic);
      }

      // Store user ID and device ID (needed for messaging)
      localStorage.setItem('userId', response.user.id);
      localStorage.setItem('deviceId', response.deviceId); // Use deviceId from login response

      // Store auth token
      localStorage.setItem('authToken', response.token);
      
      // Set token in API client for authenticated requests
      apiClient.setToken(response.token);
      
      // Navigate to chat
      navigate('/chat');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid username or password');
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-black text-white flex items-center justify-center">
      {/* Matrix rain background */}
      <MatrixRain />

      {/* Sign in form */}
      <div className="relative z-10 bg-gray-900 bg-opacity-90 p-8 rounded-lg shadow-2xl max-w-md w-full border border-green-500 border-opacity-30">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-green-400 mb-2">CipherLink</h1>
          <h2 className="text-xl text-gray-300">Sign In</h2>
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
              placeholder="Enter your username"
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="mb-6">
            <label className="block mb-2 text-green-300">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 rounded bg-gray-800 text-white border border-gray-700 focus:border-green-500 focus:outline-none"
              placeholder="Enter your password"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-green-600 rounded hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed font-semibold transition-colors"
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center text-gray-400">
          <p>
            Don't have an account?{' '}
            <Link to="/signup" className="text-green-400 hover:text-green-300">
              Sign Up
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

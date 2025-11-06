import React from 'react';
import { cleanInvalidSessions, getSessionStats, clearAllCipherLinkData } from '../../utils/sessionValidation';

export const DebugPanel: React.FC = () => {
  const [stats, setStats] = React.useState<ReturnType<typeof getSessionStats> | null>(null);
  const [cleanupResult, setCleanupResult] = React.useState<{ removed: string[]; kept: string[] } | null>(null);

  const refreshStats = () => {
    const newStats = getSessionStats();
    setStats(newStats);
    setCleanupResult(null);
  };

  const handleCleanInvalid = () => {
    const result = cleanInvalidSessions();
    setCleanupResult(result);
    refreshStats();
  };

  const handleClearAll = () => {
    if (window.confirm('⚠️ This will clear ALL CipherLink data from localStorage and log you out. Continue?')) {
      clearAllCipherLinkData();
      window.location.reload();
    }
  };

  React.useEffect(() => {
    refreshStats();
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">🔧 Debug Panel</h2>

      {/* Session Statistics */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4">Session Statistics</h3>
        
        {stats && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-100 p-4 rounded">
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-sm text-gray-600">Total Sessions</div>
              </div>
              <div className="bg-green-100 p-4 rounded">
                <div className="text-2xl font-bold text-green-700">{stats.valid}</div>
                <div className="text-sm text-gray-600">Valid Sessions</div>
              </div>
              <div className="bg-red-100 p-4 rounded">
                <div className="text-2xl font-bold text-red-700">{stats.invalid}</div>
                <div className="text-sm text-gray-600">Invalid Sessions</div>
              </div>
            </div>

            {/* Session Details */}
            {stats.details.length > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold mb-2">Session Details:</h4>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {stats.details.map((detail, idx) => (
                    <div 
                      key={idx}
                      className={`p-3 rounded text-sm ${
                        detail.valid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                      }`}
                    >
                      <div className="font-mono text-xs">{detail.key}</div>
                      {!detail.valid && detail.reason && (
                        <div className="text-red-600 mt-1">❌ {detail.reason}</div>
                      )}
                      {detail.valid && (
                        <div className="text-green-600 mt-1">✅ Valid</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex gap-3">
          <button
            onClick={refreshStats}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            🔄 Refresh Stats
          </button>
        </div>
      </div>

      {/* Cleanup Actions */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4">Cleanup Actions</h3>
        
        {cleanupResult && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded">
            <div className="font-semibold text-green-700">Cleanup Complete!</div>
            <div className="text-sm mt-2">
              <div>✅ Removed {cleanupResult.removed.length} invalid sessions</div>
              <div>✅ Kept {cleanupResult.kept.length} valid sessions</div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleCleanInvalid}
            className="w-full px-4 py-3 bg-yellow-500 text-white rounded hover:bg-yellow-600 font-semibold"
            disabled={!stats || stats.invalid === 0}
          >
            🧹 Clean Invalid Sessions {stats && stats.invalid > 0 && `(${stats.invalid})`}
          </button>

          <button
            onClick={handleClearAll}
            className="w-full px-4 py-3 bg-red-500 text-white rounded hover:bg-red-600 font-semibold"
          >
            🗑️ Clear ALL CipherLink Data (Logout)
          </button>
        </div>

        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
          <div className="font-semibold">⚠️ Warning:</div>
          <div className="mt-1">
            "Clear ALL Data" will remove all sessions, keys, and authentication data.
            You will need to sign in again.
          </div>
        </div>
      </div>

      {/* localStorage Inspector */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">localStorage Inspector</h3>
        <div className="space-y-2">
          <div className="text-sm text-gray-600">
            Total localStorage items: {Object.keys(localStorage).length}
          </div>
          <div className="text-sm text-gray-600">
            CipherLink items: {Object.keys(localStorage).filter(k => 
              k.startsWith('session_') || 
              k.startsWith('cipherlink_') ||
              ['userId', 'deviceId', 'authToken', 'identityPrivateKey', 'identityPublicKey'].includes(k)
            ).length}
          </div>
        </div>

        <button
          onClick={() => {
            const items = Object.keys(localStorage).map(key => ({
              key,
              size: localStorage.getItem(key)?.length || 0
            }));
            console.table(items);
            alert('localStorage contents logged to console (F12)');
          }}
          className="mt-3 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
        >
          📋 Log to Console
        </button>
      </div>
    </div>
  );
};

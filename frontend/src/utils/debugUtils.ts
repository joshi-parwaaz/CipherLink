/**
 * Session Recovery Utility
 * Add this to window for easy debugging
 */

declare global {
  interface Window {
    cipherlink: {
      clearSessions: () => void;
      showSessions: () => void;
      clearAll: () => void;
      version: () => void;
      stats: () => Promise<void>;
    };
  }
}

export function setupDebugUtils() {
  if (import.meta.env.DEV) {
    window.cipherlink = {
      /**
       * Clear only session data (keeps auth)
       */
      clearSessions: () => {
        const keys = Object.keys(localStorage);
        const sessionKeys = keys.filter(k => k.startsWith('session_'));
        sessionKeys.forEach(k => localStorage.removeItem(k));
        console.log(`✅ Cleared ${sessionKeys.length} sessions`);
        console.log('🔄 Reload the page to reinitialize');
      },

      /**
       * Show all session info
       */
      showSessions: () => {
        const keys = Object.keys(localStorage);
        const sessionKeys = keys.filter(k => k.startsWith('session_'));
        
        console.log(`📊 Sessions in localStorage: ${sessionKeys.length}\n`);
        
        sessionKeys.forEach(key => {
          try {
            const session = JSON.parse(localStorage.getItem(key) || '{}');
            console.log(`\n🔐 ${key}:`);
            console.log(`   Partner: ${session.partnerUsername} (${session.partnerId})`);
            console.log(`   ConvID: ${session.conversationId}`);
            console.log(`   Created: ${new Date(session.createdAt).toLocaleString()}`);
            console.log(`   Last used: ${new Date(session.lastUsedAt).toLocaleString()}`);
            console.log(`   Initiator: ${session.isInitiator ? 'Yes' : 'No'}`);
            if (session.ratchetState) {
              // Handle both serialized (string) and object formats
              let ratchetState = session.ratchetState;
              if (typeof ratchetState === 'string') {
                try {
                  ratchetState = JSON.parse(ratchetState);
                } catch (e) {
                  console.log(`   ❌ Invalid ratchet state format`);
                  return;
                }
              }
              console.log(`   Ratchet: Sending msg #${ratchetState.sendingMessageNumber || 0}, Receiving msg #${ratchetState.receivingMessageNumber || 0}`);
              console.log(`   Skipped keys: ${ratchetState.skippedMessageKeys?.size || Object.keys(ratchetState.skippedMessageKeys || {}).length || 0}`);
            }
          } catch (e) {
            console.log(`   ❌ Invalid session data:`, e);
          }
        });
      },

      /**
       * Clear ALL CipherLink data and reload
       */
      clearAll: () => {
        if (confirm('This will clear ALL data (sessions, keys, auth). Continue?')) {
          localStorage.clear();
          console.log('✅ All localStorage cleared');
          location.reload();
        }
      },

      /**
       * Show storage version info
       */
      version: () => {
        const version = localStorage.getItem('cipherlink_storage_version');
        console.log(`📦 CipherLink Storage Version: ${version || 'Not set'}`);
        console.log(`   Current app version: 1.0.0`);
        
        if (!version) {
          console.warn('⚠️ No version found - sessions may be from old version');
        }
      },

      /**
       * Show message statistics from server
       */
      stats: async () => {
        const { apiClient } = await import('../services/api');
        const sessions = Object.keys(localStorage).filter(k => k.startsWith('session_'));
        
        console.log(`\n📊 Message Statistics\n${'='.repeat(50)}`);
        
        for (const key of sessions) {
          try {
            const session = JSON.parse(localStorage.getItem(key) || '{}');
            console.log(`\n💬 ${session.partnerUsername}:`);
            
            try {
              const { messages, total } = await apiClient.getConversationMessages(
                session.conversationId,
                1000
              );
              console.log(`   Server has: ${total} encrypted messages`);
              
              if (total > 0) {
                console.log(`   Status breakdown:`);
                const statusCount = messages.reduce((acc, msg) => {
                  acc[msg.status] = (acc[msg.status] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>);
                
                Object.entries(statusCount).forEach(([status, count]) => {
                  console.log(`     ${status}: ${count}`);
                });
              }
            } catch (e) {
              console.log(`   ❌ Failed to fetch stats:`, e instanceof Error ? e.message : 'Unknown error');
            }
          } catch (e) {
            console.log(`   ❌ Invalid session data`);
          }
        }
        
        console.log(`\n${'='.repeat(50)}`);
      }
    };

    console.log(`
╔════════════════════════════════════════╗
║   🔧 CipherLink Debug Utils Available  ║
╚════════════════════════════════════════╝

Usage:
  cipherlink.clearSessions()  - Clear sessions only
  cipherlink.showSessions()   - Show session details
  cipherlink.clearAll()       - Clear ALL data
  cipherlink.version()        - Check storage version
  cipherlink.stats()          - Show message stats from server
    `);
  }
}

import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../services/api';
import { messagingService } from '../../services/messaging';
import { realtimeClient } from '../../services/realtime';

interface Message {
  id: string;
  senderId: string;
  senderUsername: string;
  plaintext: string;
  timestamp: Date;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
}

interface Conversation {
  id: string;
  partnerId: string;
  partnerUsername: string;
  messages: Message[];
  unreadCount: number;
  status?: 'pending' | 'accepted' | 'rejected'; // Track conversation status
}

interface PendingRequest {
  convId: string;
  initiatorUserId: string;
  initiatorUsername: string;
  createdAt: string;
}

export default function Chat() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'chats' | 'requests'>('chats'); // Tab selection
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [_processedMessageIds, setProcessedMessageIds] = useState<Set<string>>(new Set());
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  // Get active conversation
  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  // Initialize on mount
  useEffect(() => {
    const initializeChat = async () => {
      try {
        // Check auth
        const token = localStorage.getItem('authToken');
        if (!token) {
          navigate('/signin');
          return;
        }

        // Set token in API client
        apiClient.setToken(token);

        // Get current user from token
        const payload = JSON.parse(atob(token.split('.')[1]));
        setCurrentUser({
          id: payload.userId,
          username: payload.username,
        });

        // Initialize messaging service
        await messagingService.initialize(payload.userId);

        // Connect to realtime
        realtimeClient.connect(token);

        // Load existing sessions from localStorage
        const sessions = messagingService.getAllSessions();
        const conversationMap = new Map<string, Conversation>();

        // Add conversations from sessions first
        sessions.forEach((session) => {
          conversationMap.set(session.conversationId, {
            id: session.conversationId,
            partnerId: session.partnerId,
            partnerUsername: session.partnerUsername,
            messages: [],
            unreadCount: 0,
            status: 'accepted' as const, // Sessions in storage are already accepted
          });
        });

        // Fetch all conversations from backend to get pending requests we initiated
        try {
          const { conversations: backendConvs } = await apiClient.getConversations();
          const userId = localStorage.getItem('userId');
          // Process backend conversations
          for (const conv of backendConvs) {
            // Skip if we already have this conversation
            if (conversationMap.has(conv.convId)) {
              continue;
            }

            // Only include if it's a pending request WE initiated
            // (Pending requests others sent to us are handled by pending requests tab)
            if (conv.status === 'pending' && conv.initiatorUserId !== userId) {
              continue;
            }

            // For accepted conversations, add them if we don't have them
            if (conv.status === 'accepted') {
              // Get partner info
              const partnerId = conv.memberUserIds.find(id => id !== userId);
              if (!partnerId || partnerId === userId) continue;

              // Fetch partner username
              let partnerUsername = partnerId;
              try {
                const partnerUser = await apiClient.getUserById(partnerId);
                partnerUsername = partnerUser.username;
              } catch (err) {}

              conversationMap.set(conv.convId, {
                id: conv.convId,
                partnerId,
                partnerUsername,
                messages: [],
                unreadCount: 0,
                status: 'accepted',
              });
            }

            // For pending conversations we initiated
            if (conv.status === 'pending' && conv.initiatorUserId === userId) {
              // Get partner info
              const partnerId = conv.memberUserIds.find(id => id !== userId);
              if (!partnerId || partnerId === userId) continue;

              // Fetch partner username
              let partnerUsername = partnerId;
              try {
                const partnerUser = await apiClient.getUserById(partnerId);
                partnerUsername = partnerUser.username;
              } catch (err) {}

              conversationMap.set(conv.convId, {
                id: conv.convId,
                partnerId,
                partnerUsername,
                messages: [],
                unreadCount: 0,
                status: 'pending',
              });
            }
          }
        } catch (err) {
        }
        setConversations(Array.from(conversationMap.values()));

        // ⚡ FETCH PENDING MESSAGES FROM SERVER
        const deviceId = localStorage.getItem('deviceId');
        if (deviceId) {
          try {
            const pendingMessages = await apiClient.getPendingMessages(deviceId);
            // Process each pending message
            for (const msg of pendingMessages) {
              try {
                // Find the conversation
                const session = messagingService.getSession(msg.convId);
                if (!session) {
                  continue;
                }

                // The ciphertext from server is now already in the correct JSON format
                // (includes both envelope and header)
                const messageForDecryption = {
                  messageId: msg.messageId,
                  conversationId: msg.convId,
                  senderId: msg.fromUserId,
                  ciphertext: msg.ciphertext, // Already in correct JSON format
                  timestamp: new Date(msg.serverReceivedAt).toISOString(),
                };

                // Check if message has already been processed
                if (processedMessageIdsRef.current.has(msg.messageId)) {
                  console.log('[initial] Skipping duplicate message:', msg.messageId);
                  continue;
                }

                // Decrypt the message
                const decrypted = await messagingService.receiveMessage(messageForDecryption);

                // Skip self-sent echoes (they return empty plaintext)
                if (decrypted.plaintext === '') {
                  console.log('[initial] Skipping self-sent message echo');
                  continue;
                }

                // Mark message as processed
                processedMessageIdsRef.current.add(msg.messageId);
                setProcessedMessageIds(prev => new Set(prev).add(msg.messageId));

                // ✅ Acknowledge successful decryption
                try {
                  console.log('[initial] Sending ACK for message:', msg.messageId);
                  realtimeClient.acknowledgeMessage(msg.messageId);
                  console.log('[initial] ACK sent successfully');
                } catch (ackErr) {
                  console.error('[initial] ACK failed:', ackErr);
                }

                // Add to conversations
                setConversations((prev) => {
                  const existing = prev.find((c) => c.id === msg.convId);

                  if (existing) {
                    const newMessage: Message = {
                      id: msg.messageId,
                      senderId: msg.fromUserId,
                      senderUsername: existing.partnerUsername,
                      plaintext: decrypted.plaintext,
                      timestamp: new Date(msg.serverReceivedAt),
                      status: 'delivered',
                    };

                    return prev.map((c) =>
                      c.id === msg.convId
                        ? {
                            ...c,
                            messages: [...c.messages, newMessage],
                            unreadCount: c.unreadCount + 1,
                          }
                        : c
                    );
                  }
                  return prev;
                });
              } catch (decryptErr) {
                // ❌ Report decryption failure (NACK)
                try {
                  const reason = decryptErr instanceof Error ? decryptErr.message : 'Unknown error';
                  realtimeClient.reportMessageFailure(msg.messageId, reason);
                } catch (nackErr) {
                }
              }
            }
          } catch (fetchErr) {
          }
        }

        // ⚡ FETCH PENDING CONVERSATION REQUESTS
        try {
          const { pending } = await apiClient.getPendingConversationRequests();
          console.log('[Chat] Fetched pending requests:', pending);
          setPendingRequests(pending);
        } catch (fetchErr) {
          console.error('[Chat] Failed to fetch pending requests:', fetchErr);
        }

        setLoading(false);
      } catch (err) {
        navigate('/signin');
      }
    };

    initializeChat();

    // Set up periodic polling for messages (backup to WebSocket)
    const pollInterval = setInterval(async () => {
      const deviceId = localStorage.getItem('deviceId');
      if (deviceId && !loading) {
        try {
          const pendingMessages = await apiClient.getPendingMessages(deviceId);
          if (pendingMessages.length > 0) {
            console.log('[polling] Found pending messages:', pendingMessages.length);
            // Process messages same way as initial fetch
            for (const msg of pendingMessages) {
              try {
                const session = messagingService.getSession(msg.convId);
                if (!session) {
                  // For recipients, session might not exist yet - try to process anyway
                  // receiveMessage will handle session creation for Bob
                }

                // The ciphertext from server is now already in the correct JSON format
                const messageForDecryption = {
                  messageId: msg.messageId,
                  conversationId: msg.convId,
                  senderId: msg.fromUserId,
                  ciphertext: msg.ciphertext, // Already in correct JSON format
                  timestamp: new Date(msg.serverReceivedAt).toISOString(),
                };

                // Check if message has already been processed
                if (processedMessageIdsRef.current.has(msg.messageId)) {
                  console.log('[polling] Skipping duplicate message:', msg.messageId);
                  continue;
                }

                const decrypted = await messagingService.receiveMessage(messageForDecryption);

                // Skip self-sent echoes (they return empty plaintext)
                if (decrypted.plaintext === '') {
                  console.log('[polling] Skipping self-sent message echo');
                  continue;
                }

                // Mark message as processed
                processedMessageIdsRef.current.add(msg.messageId);
                setProcessedMessageIds(prev => new Set(prev).add(msg.messageId));

                // ✅ Acknowledge successful decryption
                try {
                  console.log('[polling] Sending ACK for message:', msg.messageId);
                  realtimeClient.acknowledgeMessage(msg.messageId);
                  console.log('[polling] ACK sent successfully');
                } catch (ackErr) {
                  console.error('[polling] ACK failed:', ackErr);
                }

                setConversations((prev) => {
                  const existing = prev.find((c) => c.id === msg.convId);
                  if (existing) {
                    // Check if message already exists
                    const messageExists = existing.messages.some((m) => m.id === msg.messageId);
                    if (messageExists) return prev;

                    const newMessage: Message = {
                      id: msg.messageId,
                      senderId: msg.fromUserId,
                      senderUsername: existing.partnerUsername,
                      plaintext: decrypted.plaintext,
                      timestamp: new Date(msg.serverReceivedAt),
                      status: 'delivered',
                    };

                    return prev.map((c) =>
                      c.id === msg.convId
                        ? {
                            ...c,
                            messages: [...c.messages, newMessage],
                            unreadCount: c.id === activeConversationId ? 0 : c.unreadCount + 1,
                          }
                        : c
                    );
                  }
                  return prev;
                });
              } catch (err) {
                // ❌ Report decryption failure (NACK)
                try {
                  const reason = err instanceof Error ? err.message : 'Unknown error';
                  realtimeClient.reportMessageFailure(msg.messageId, reason);
                } catch (nackErr) {
                }
              }
            }
          }
        } catch (err) {
        }
      }
    }, 3000); // Poll every 3 seconds

    return () => {
      realtimeClient.disconnect();
      clearInterval(pollInterval);
    };
  }, [navigate, loading]); // Removed activeConversationId - caused re-initialization on click!

  // Join conversation room when active conversation changes
  useEffect(() => {
    if (activeConversationId) {
      realtimeClient.joinConversation(activeConversationId);
      console.log('[Chat] Joined conversation room:', activeConversationId);
    }

    return () => {
      if (activeConversationId) {
        realtimeClient.leaveConversation(activeConversationId);
        console.log('[Chat] Left conversation room:', activeConversationId);
      }
    };
  }, [activeConversationId]);

  // Handle incoming messages
  useEffect(() => {
    const handleIncomingMessage = async (data: {
      messageId: string;
      conversationId: string;
      senderId: string;
      ciphertext: string;
      timestamp: string;
    }) => {
      console.log('[websocket] Processing message:', data.messageId, {
        conversationId: data.conversationId,
        senderId: data.senderId,
        ciphertextLength: data.ciphertext.length,
        timestamp: data.timestamp
      });

      // Check if message has already been processed
      if (processedMessageIdsRef.current.has(data.messageId)) {
        console.log('[websocket] Skipping duplicate message:', data.messageId);
        return;
      }

      try {
        console.log('[websocket] Calling receiveMessage...');
        const decrypted = await messagingService.receiveMessage(data);
        console.log('[websocket] Message decrypted successfully:', decrypted.messageId, {
          plaintextLength: decrypted.plaintext.length,
          senderId: decrypted.senderId
        });

        // Skip self-sent echoes (they return empty plaintext)
        if (decrypted.plaintext === '') {
          console.log('[websocket] Skipping self-sent message echo');
          return;
        }

        // Mark message as processed
        processedMessageIdsRef.current.add(data.messageId);
        setProcessedMessageIds(prev => new Set(prev).add(data.messageId));

        // ✅ Acknowledge successful decryption
        try {
          console.log('[websocket] Sending ACK...');
          realtimeClient.acknowledgeMessage(data.messageId);
          console.log('[websocket] ACK sent');
        } catch (ackErr) {
          console.error('[websocket] ACK failed:', ackErr);
        }

        console.log('[websocket] Updating conversations...');
        // Find or create conversation
        setConversations((prev) => {
          const existing = prev.find((c) => c.id === data.conversationId);
          console.log('[websocket] Existing conversation found:', !!existing);

          if (existing) {
            const existingMessageIndex = existing.messages.findIndex(m => m.id === data.messageId);
            const newMessage: Message = {
              id: data.messageId,
              senderId: data.senderId,
              senderUsername: existing.partnerUsername,
              plaintext: decrypted.plaintext,
              timestamp: new Date(data.timestamp),
              status: 'delivered',
            };

            return prev.map(conv => {
              if (conv.id !== data.conversationId) return conv;

              let updatedMessages;
              if (existingMessageIndex !== -1) {
                console.debug('[websocket] Updating existing message:', data.messageId);
                updatedMessages = conv.messages.map(m =>
                  m.id === data.messageId ? { ...m, ...newMessage } : m
                );
              } else {
                console.debug('[websocket] Appending new decrypted message:', data.messageId);
                updatedMessages = [...conv.messages, newMessage];
              }

              console.log('[Chat] Message added/updated:', data.messageId);
              console.log('[Chat] Conversation message count:', updatedMessages.length);

              return {
                ...conv,
                messages: updatedMessages,
                unreadCount: conv.id === activeConversationId ? 0 : conv.unreadCount + 1,
              };
            });
          } else {
            // Create new conversation (only if it doesn't exist)
            console.log('[websocket] Creating new conversation');
            const session = messagingService.getSession(data.conversationId);
            const newMessage: Message = {
              id: data.messageId,
              senderId: data.senderId,
              senderUsername: session?.partnerUsername || 'Unknown',
              plaintext: decrypted.plaintext,
              timestamp: decrypted.timestamp,
              status: 'delivered',
            };
            const newConversation: Conversation = {
              id: data.conversationId,
              partnerId: data.senderId,
              partnerUsername: session?.partnerUsername || 'Unknown',
              messages: [newMessage],
              unreadCount: 1,
            };

            // Check if conversation already exists (prevent duplicates from initialization)
            const conversationExists = prev.some((c) => c.id === data.conversationId);
            if (conversationExists) {
              console.log('[websocket] Conversation already exists, skipping duplicate creation');
              return prev;
            }

            console.log('[Chat] Creating new conversation with message:', newMessage.id);
            return [...prev, newConversation];
          }
        });
        console.log('[websocket] Message processing complete');
        
        // Auto-select the conversation if it's not currently active
        if (data.conversationId !== activeConversationId) {
          console.log('[Chat] Auto-selecting conversation:', data.conversationId);
          setActiveConversationId(data.conversationId);
        }
      } catch (err) {
        console.error('[websocket] Message processing failed:', err);
        // ❌ Report decryption failure (NACK)
        try {
          const reason = err instanceof Error ? err.message : 'Unknown error';
          console.log('[websocket] Sending NACK:', reason);
          realtimeClient.reportMessageFailure(data.messageId, reason);
        } catch (nackErr) {
          console.error('[websocket] NACK failed:', nackErr);
        }
      }
    };

    const unsubscribe = realtimeClient.onMessage(handleIncomingMessage);
    return () => unsubscribe();
  }, [activeConversationId]);

  // Listen for incoming conversation requests
  useEffect(() => {
    const handleConversationRequest = (data: {
      convId: string;
      type: string;
      initiatorUserId: string;
      initiatorUsername: string;
      groupName?: string;
      createdAt: string;
    }) => {
      console.log('[Chat] Received conversation request via WebSocket:', data);

      // Check if this request is already in pendingRequests to prevent duplicates
      setPendingRequests((prev) => {
        const exists = prev.some(req => req.convId === data.convId);
        if (exists) {
          console.log('[Chat] Ignoring duplicate conversation request', data.convId);
          return prev;
        }

        const newRequest = {
          convId: data.convId,
          initiatorUserId: data.initiatorUserId,
          initiatorUsername: data.initiatorUsername,
          createdAt: data.createdAt,
        };

        console.log('[Chat] Adding new conversation request to pending list', newRequest);
        return [...prev, newRequest];
      });

      // Show notification badge on Requests tab
      if (view === 'chats') {
        // Could trigger a toast notification here
      }
    };

    const unsubscribe = realtimeClient.onConversationRequest(handleConversationRequest);
    return () => unsubscribe();
  }, [view]);

  // Listen for conversation acceptance (when recipient accepts your request)
  useEffect(() => {
    const handleConversationAccepted = async (data: {
      convId: string;
      acceptedBy: string;
      acceptedByUsername: string;
    }) => {
      console.log('[Chat] Conversation accepted', data);

      // Update conversation status from 'pending' to 'accepted'
      setConversations((prev) =>
        prev.map((c) =>
          c.id === data.convId
            ? { ...c, status: 'accepted' as const }
            : c
        )
      );

      // If this is our request that was accepted, initialize session for sending first message
      const conversation = conversations.find(c => c.id === data.convId);
      if (conversation && data.acceptedBy !== currentUser.id) {
        try {
          await messagingService.initializeSessionAfterAccept(
            data.convId,
            data.acceptedBy,
            data.acceptedByUsername
          );
        } catch (err) {
          console.error('[Chat] Failed to initialize session after acceptance:', err);
        }
      }
    };

    const unsubscribe = realtimeClient.onConversationAccepted(handleConversationAccepted);
    return () => unsubscribe();
  }, [conversations]);

  // Handle user search
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const results = await apiClient.searchUsers(query, 10);
      setSearchResults(results);
    } catch (err) {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  // Start conversation with a user
  const handleStartConversation = async (user: any) => {
    try {
      // Check if conversation already exists
      const existing = conversations.find((c) => c.partnerId === user.id);
      // If an existing conversation is found but we don't have a local session for it,
      // treat it as if it doesn't exist so the user can start a fresh secure session.
      if (existing) {
        if (messagingService.hasSession(existing.id)) {
          setActiveConversationId(existing.id);
          setSearchQuery('');
          setSearchResults([]);
          return;
        }
        // Otherwise fallthrough and create a new conversation to re-establish keys
      }

      // Send conversation request (NO session created yet)
      const conversationId = await messagingService.sendConversationRequest(user.id, user.username);

      // Check if this conversation ID already exists in our conversations list
      // This can happen if the backend returned an existing conversation
      const existingConversation = conversations.find((c) => c.id === conversationId);
      if (existingConversation) {
        console.log('[startConversation] Switching to existing conversation', conversationId);
        setActiveConversationId(conversationId);
        setSearchQuery('');
        setSearchResults([]);
        return;
      }

      const newConversation: Conversation = {
        id: conversationId,
        partnerId: user.id,
        partnerUsername: user.username,
        messages: [],
        unreadCount: 0,
        status: 'pending', // Mark as pending until accepted
      };

      setConversations((prev) => [...prev, newConversation]);
      setActiveConversationId(conversationId);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      alert('Failed to start conversation. Please try again.');
    }
  };

  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!messageInput.trim() || !activeConversationId || sendingRef.current) {
      return;
    }

    const content = messageInput.trim();
    setMessageInput('');
    sendingRef.current = true;
    setSending(true);

    try {
      // Find the active conversation
      const activeConv = conversations.find(c => c.id === activeConversationId);
      if (!activeConv) {
        throw new Error('Conversation not found');
      }

      // Initialize session if it doesn't exist (for initiator after accept)
      // This handles the case where:
      // 1. Alice receives the accept notification but hasn't initialized session yet
      // 2. WebSocket was delayed/failed, but conversation was actually accepted on backend
      if (!messagingService.hasSession(activeConversationId)) {
        try {
          console.log('[sendMessage] Initializing session for conversation', activeConversationId);
          await messagingService.initializeSessionAfterAccept(
            activeConversationId,
            activeConv.partnerId,
            activeConv.partnerUsername
          );
          console.log('[sendMessage] Session initialized successfully');

          // Update local status to 'accepted' now that we have a session
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeConversationId
                ? { ...c, status: 'accepted' as const }
                : c
            )
          );
        } catch (sessionErr: any) {
          console.error('[sendMessage] Session initialization failed:', sessionErr);

          // If we can't initialize session, check if conversation might actually be accepted
          // by trying to fetch the latest conversation data
          try {
            const latestConv = await apiClient.getConversation(activeConversationId);
            if (latestConv && latestConv.memberUserIds.includes(currentUser.id)) {
              // Conversation exists and we're a member, try sending anyway
              // The session might be initializable on the next attempt
              console.log('[sendMessage] Conversation exists, attempting to send without session');
            } else {
              throw new Error('Conversation not found or not a member');
            }
          } catch (convErr) {
            console.error('[sendMessage] Conversation check failed:', convErr);
            if (sessionErr.message?.includes('no registered devices')) {
              throw new Error('The recipient has not set up their encryption keys yet. Please ask them to sign in.');
            }
            throw new Error('Unable to establish secure session. The recipient may not have accepted your request yet.');
          }
        }
      }

      // Add temporary message
      const tempId = `temp_${crypto.randomUUID()}`;
      const tempMessage: Message = {
        id: tempId,
        senderId: currentUser.id,
        senderUsername: currentUser.username,
        plaintext: content,
        timestamp: new Date(),
        status: 'sending',
      };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversationId
            ? { ...c, messages: [...c.messages, tempMessage] }
            : c
        )
      );

      // Encrypt and send
      const result = await messagingService.sendMessage(activeConversationId, content);

      // Update message with real ID and status
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversationId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === tempId ? { ...m, id: result.messageId, status: 'sent' } : m
                ),
              }
            : c
        )
      );
    } catch (err: any) {
      // Show detailed error message
      const errorMsg = err.response?.data?.error || err.response?.data?.details || err.message;
      alert(`Failed to send: ${errorMsg}`);

      // Mark as failed
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversationId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.status === 'sending' ? { ...m, status: 'failed' } : m
                ),
              }
            : c
        )
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  // Handle accepting conversation request
  const handleAcceptRequest = async (convId: string, initiatorUsername: string) => {
    try {
      // Find the full request data to get initiatorUserId
      const request = pendingRequests.find(r => r.convId === convId);
      if (!request) {
        return;
      }
      
      // Accept on backend
      await apiClient.acceptConversationRequest(convId);
      
      // Bob does NOT initialize session here
      // He will initialize when he receives Alice's first message (which contains ephemeral key)
      // Remove from pending requests
      setPendingRequests(prev => prev.filter(r => r.convId !== convId));
      
      // Add to conversations list (only if it doesn't already exist)
      setConversations(prev => {
        const conversationExists = prev.some((c) => c.id === convId);
        if (conversationExists) {
          console.log('[accept] Conversation already exists, skipping duplicate creation');
          return prev;
        }

        return [
          ...prev,
          {
            id: convId,
            partnerId: request.initiatorUserId,
            partnerUsername: initiatorUsername,
            messages: [],
            unreadCount: 0,
            status: 'accepted', // Mark as accepted
          },
        ];
      });

      // Join the conversation room
      realtimeClient.joinConversation(convId);
      console.log('[accept] Joined conversation room after accepting:', convId);
    } catch (err) {
      alert('Failed to accept conversation request');
    }
  };

  // Handle rejecting conversation request
  const handleRejectRequest = async (convId: string) => {
    try {
      await apiClient.rejectConversationRequest(convId);
      
      // Remove from pending requests
      setPendingRequests(prev => prev.filter(r => r.convId !== convId));
    } catch (err) {
      alert('Failed to reject conversation request');
    }
  };

  const handleLogout = () => {
    // Clear messaging sessions
    messagingService.getAllSessions().forEach(session => {
      messagingService.deleteSession(session.conversationId);
    });
    // Clear processed message IDs
    setProcessedMessageIds(new Set());
    processedMessageIdsRef.current.clear();
    localStorage.clear();
    navigate('/');
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-green-400">
        <div className="text-center">
          <div className="mb-4 text-6xl animate-pulse">🔐</div>
          <p className="text-xl font-mono">INITIALIZING SECURE CHANNEL...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-black text-green-400">
      {/* Sidebar */}
      <div className="w-80 border-r border-green-500/20 bg-black flex flex-col">
        {/* Header */}
        <div className="border-b border-green-500/20 p-4 bg-gradient-to-r from-black to-green-950/20">
          <h1 className="text-2xl font-bold font-mono tracking-wider">
            CIPHER<span className="text-green-500">LINK</span>
          </h1>
          <p className="text-xs text-green-500/70 mt-1 font-mono">END-TO-END ENCRYPTED</p>
          <div className="mt-3 text-sm text-green-400/80">
            <span className="font-mono">@{currentUser?.username}</span>
          </div>
        </div>

        {/* Tabs: Chats / Requests */}
        <div className="flex border-b border-green-500/20">
          <button
            onClick={() => setView('chats')}
            className={`flex-1 py-3 font-mono text-sm transition-all ${
              view === 'chats'
                ? 'bg-green-500/20 text-green-400 border-b-2 border-green-500'
                : 'text-green-500/60 hover:bg-green-500/10'
            }`}
          >
            CHATS
          </button>
          <button
            onClick={() => setView('requests')}
            className={`flex-1 py-3 font-mono text-sm transition-all relative ${
              view === 'requests'
                ? 'bg-green-500/20 text-green-400 border-b-2 border-green-500'
                : 'text-green-500/60 hover:bg-green-500/10'
            }`}
          >
            REQUESTS
            {pendingRequests.length > 0 && (
              <span className="absolute top-2 right-2 bg-green-500 text-black rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                {pendingRequests.length}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-green-500/20">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search users..."
              className="w-full bg-black border border-green-500/30 rounded px-3 py-2 text-green-400 placeholder-green-500/40 focus:outline-none focus:border-green-500 font-mono text-sm"
            />
            {searching && (
              <div className="absolute right-3 top-2.5">
                <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>
        </div>

        {/* Content Area: Search Results / Conversations / Requests */}
        <div className="flex-1 overflow-y-auto">
          {searchQuery.trim().length >= 2 ? (
            // Search Results
            <div className="p-2">
              <div className="text-xs text-green-500/60 px-2 py-1 font-mono">SEARCH RESULTS</div>
              {searchResults.length > 0 ? (
                searchResults.map((user) => (
                  <div
                    key={user.id}
                    onClick={() => handleStartConversation(user)}
                    className="p-3 hover:bg-green-500/10 cursor-pointer border-l-2 border-transparent hover:border-green-500 transition-all"
                  >
                    <div className="font-mono text-sm text-green-400">@{user.username}</div>
                    <div className="text-xs text-green-500/60 mt-1">{user.displayName}</div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-green-500/40 text-sm font-mono">
                  {searching ? 'SCANNING...' : 'NO USERS FOUND'}
                </div>
              )}
            </div>
          ) : view === 'requests' ? (
            // Pending Requests
            <div className="p-2">
              <div className="text-xs text-green-500/60 px-2 py-1 font-mono">PENDING REQUESTS</div>
              {pendingRequests.length > 0 ? (
                pendingRequests.map((request) => (
                  <div
                    key={request.convId}
                    className="p-3 border-l-2 border-yellow-500/50 bg-yellow-500/5 mb-2"
                  >
                    <div className="font-mono text-sm text-green-400 mb-2">
                      @{request.initiatorUsername}
                    </div>
                    <div className="text-xs text-green-500/60 mb-3">
                      Wants to start a conversation
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAcceptRequest(request.convId, request.initiatorUsername)}
                        className="flex-1 py-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500 text-green-400 rounded font-mono text-xs transition-all"
                      >
                        ✓ ACCEPT
                      </button>
                      <button
                        onClick={() => handleRejectRequest(request.convId)}
                        className="flex-1 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500 text-red-400 rounded font-mono text-xs transition-all"
                      >
                        ✗ REJECT
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-green-500/40 text-sm font-mono">
                  No pending requests
                </div>
              )}
            </div>
          ) : (
            // Conversations List
            <div className="p-2">
              <div className="text-xs text-green-500/60 px-2 py-1 font-mono">CONVERSATIONS</div>
              {conversations.length > 0 ? (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => {
                      setActiveConversationId(conv.id);
                    }}
                    className={`p-3 cursor-pointer border-l-2 transition-all ${
                      conv.id === activeConversationId
                        ? 'bg-green-500/20 border-green-500'
                        : 'border-transparent hover:bg-green-500/10 hover:border-green-500'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-sm text-green-400">
                        @{conv.partnerUsername}
                        {conv.status === 'pending' && <span className="ml-2 text-xs text-yellow-500">⏳ Pending</span>}
                      </div>
                      {conv.unreadCount > 0 && (
                        <div className="bg-green-500 text-black rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                          {conv.unreadCount}
                        </div>
                      )}
                    </div>
                    {conv.messages.length > 0 && (
                      <div className="text-xs text-green-500/60 mt-1 truncate">
                        {conv.messages[conv.messages.length - 1].plaintext}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-green-500/40 text-sm font-mono">
                  No conversations yet
                </div>
              )}
            </div>
          )}
        </div>

        {/* Logout Button */}
        <div className="p-4 border-t border-green-500/20 space-y-2">
          <button
            onClick={async () => {
              try {
                // Clear conversations from backend (development only)
                await apiClient.clearConversations();
                
                // Clear all messaging sessions
                messagingService.getAllSessions().forEach(session => {
                  messagingService.deleteSession(session.conversationId);
                });
                // Clear conversations from state
                setConversations([]);
                // Clear session data from localStorage (but keep user auth)
                const keysToRemove = Object.keys(localStorage).filter(key => key.startsWith('session_'));
                keysToRemove.forEach(key => localStorage.removeItem(key));
                // Clear processed message IDs
                setProcessedMessageIds(new Set());
                processedMessageIdsRef.current.clear();
                alert('All conversations and sessions cleared from backend and frontend.');
              } catch (err) {
                // Fallback to frontend-only clearing if backend clear fails
                // Clear all messaging sessions
                messagingService.getAllSessions().forEach(session => {
                  messagingService.deleteSession(session.conversationId);
                });
                // Clear conversations from state
                setConversations([]);
                // Clear session data from localStorage (but keep user auth)
                const keysToRemove = Object.keys(localStorage).filter(key => key.startsWith('session_'));
                keysToRemove.forEach(key => localStorage.removeItem(key));
                // Clear processed message IDs
                setProcessedMessageIds(new Set());
                processedMessageIdsRef.current.clear();
                alert('Backend clear failed, cleared sessions from frontend only. Conversations may persist on refresh.');
              }
            }}
            className="w-full py-2 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500 text-yellow-400 rounded font-mono text-sm transition-all"
          >
            CLEAR ALL DATA
          </button>
          <button
            onClick={() => navigate('/')}
            className="w-full py-2 bg-green-950/30 hover:bg-green-950/50 border border-green-500/30 hover:border-green-500 text-green-400 rounded font-mono text-sm transition-all"
          >
            ← BACK TO HOME
          </button>
          <button
            onClick={handleLogout}
            className="w-full py-2 bg-red-950/30 hover:bg-red-950/50 border border-red-500/30 hover:border-red-500 text-red-400 rounded font-mono text-sm transition-all"
          >
            DISCONNECT
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-gradient-to-br from-black via-green-950/5 to-black">
        {activeConversation ? (
          <>
            {/* Chat Header */}
            <div className="border-b border-green-500/20 p-4 bg-black/50">
              <div className="font-mono text-lg text-green-400">@{activeConversation.partnerUsername}</div>
              <div className="text-xs text-green-500/60 mt-1 font-mono">🔒 END-TO-END ENCRYPTED</div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {activeConversation.messages
                .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                .map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.senderId === currentUser?.id ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] rounded p-3 ${
                      msg.senderId === currentUser?.id
                        ? 'bg-green-500/20 border border-green-500/30'
                        : 'bg-green-950/30 border border-green-500/20'
                    }`}
                  >
                    <div className="text-sm text-green-400 font-mono">{msg.plaintext}</div>
                    <div className="text-xs text-green-500/60 mt-2 flex items-center justify-between font-mono">
                      <span>{msg.timestamp.toLocaleTimeString()}</span>
                      {msg.senderId === currentUser?.id && (
                        <span className="ml-2">
                          {msg.status === 'sending' && '⏳'}
                          {msg.status === 'sent' && '✓'}
                          {msg.status === 'delivered' && '✓✓'}
                          {msg.status === 'read' && '✓✓✓'}
                          {msg.status === 'failed' && '❌'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Message Input */}
            <div className="border-t border-green-500/20 p-4 bg-black/50">
              {activeConversation.status === 'pending' ? (
                <div className="text-center py-3 px-4 bg-yellow-500/10 border border-yellow-500/30 rounded">
                  <div className="text-yellow-500 font-mono text-sm">
                    ⏳ Waiting for @{activeConversation.partnerUsername} to accept your conversation request
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder="Type encrypted message..."
                    disabled={sending}
                    className="flex-1 bg-black border border-green-500/30 rounded px-4 py-3 text-green-400 placeholder-green-500/40 focus:outline-none focus:border-green-500 font-mono disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!messageInput.trim() || sending}
                    className="px-6 py-3 bg-green-500/20 hover:bg-green-500/30 border border-green-500 text-green-400 rounded font-mono font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sending ? '⏳' : 'SEND'}
                  </button>
                </form>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="mb-8">
                <div className="text-9xl mb-6 opacity-10">💬</div>
                <h2 className="text-3xl font-bold font-mono mb-4 text-green-400">
                  SELECT A CONVERSATION
                </h2>
                <p className="text-green-500/60 font-mono text-sm leading-relaxed">
                  Search for a user in the sidebar to start<br/>
                  an end-to-end encrypted conversation
                </p>
              </div>
              
              <div className="mt-8 p-4 bg-green-500/5 border border-green-500/20 rounded">
                <div className="text-xs text-green-500/70 font-mono space-y-1">
                  <div>🔒 ZERO-ACCESS ARCHITECTURE</div>
                  <div>🔐 XChaCha20-Poly1305 ENCRYPTION</div>
                  <div>🛡️ DOUBLE RATCHET PROTOCOL</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

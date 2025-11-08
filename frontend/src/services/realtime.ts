import { io, Socket } from 'socket.io-client';

/**
 * Real-time communication client using Socket.IO
 */

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

type MessageHandler = (data: {
  messageId: string;
  conversationId: string;
  senderId: string;
  ciphertext: string;
  timestamp: string;
}) => void;

type ReceiptHandler = (data: {
  messageId: string;
  status: 'delivered' | 'read';
  deviceId: string;
}) => void;

type ConversationRequestHandler = (data: {
  convId: string;
  type: string;
  initiatorUserId: string;
  initiatorUsername: string;
  groupName?: string;
  createdAt: string;
}) => void;

type ConversationAcceptedHandler = (data: {
  convId: string;
  acceptedBy: string;
  acceptedByUsername: string;
}) => void;

type ConnectionHandler = () => void;

class RealtimeClient {
  private socket: Socket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private receiptHandlers: Set<ReceiptHandler> = new Set();
  private conversationRequestHandlers: Set<ConversationRequestHandler> = new Set();
  private conversationAcceptedHandlers: Set<ConversationAcceptedHandler> = new Set();
  private connectHandlers: Set<ConnectionHandler> = new Set();
  private disconnectHandlers: Set<ConnectionHandler> = new Set();

  connect(token: string): void {
    if (this.socket?.connected) {
      return;
    }

    this.socket = io(SOCKET_URL, {
      auth: {
        token,
      },
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      // Backend auto-registers authenticated connections
      console.debug('[realtime] connected and auto-registered', { socketId: this.socket?.id });
      console.log('[realtime] Websocket connected successfully');
      
      this.connectHandlers.forEach((handler) => handler());
    });

    this.socket.on('disconnect', () => {
      // silent disconnect
      this.disconnectHandlers.forEach((handler) => handler());
    });

    this.socket.on('message:new', (data) => {
      // The backend sends the ciphertext as the JSON string containing envelope and header
      // We just need to map the field names to what the frontend expects
      const mappedData = {
        messageId: data.messageId,
        conversationId: data.convId,         // Backend sends "convId"
        senderId: data.fromUserId,            // Backend sends "fromUserId"
        ciphertext: data.ciphertext,          // This is already the JSON string with envelope+header
        timestamp: data.serverReceivedAt,     // Backend sends "serverReceivedAt"
      };
      
      console.log('[realtime:message:new] 📨 RECEIVED WebSocket message', {
        messageId: mappedData.messageId,
        conversationId: mappedData.conversationId,
        senderId: mappedData.senderId,
        serverReceivedAt: mappedData.timestamp,
        ciphertextLength: mappedData.ciphertext.length,
        socketId: this.socket?.id
      });
      
      // Debug: log incoming message payload (non-sensitive fields)
      try {
        console.debug('[realtime] message:new received', {
          messageId: mappedData.messageId,
          conversationId: mappedData.conversationId,
          from: mappedData.senderId,
          serverReceivedAt: mappedData.timestamp,
          ciphertextLength: mappedData.ciphertext.length,
        });
      } catch (err) {}

      this.messageHandlers.forEach((handler) => handler(mappedData));
    });

    this.socket.on('receipt:update', (data) => {
      this.receiptHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('conversationRequest', (data) => {
      this.conversationRequestHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('conversationAccepted', (data) => {
      this.conversationAcceptedHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('error', (err) => {
      console.error('[realtime] socket error', err);
      // Socket errors handled by disconnect event
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  // ========== Event Handlers ==========

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onReceipt(handler: ReceiptHandler): () => void {
    this.receiptHandlers.add(handler);
    return () => this.receiptHandlers.delete(handler);
  }

  onConversationRequest(handler: ConversationRequestHandler): () => void {
    this.conversationRequestHandlers.add(handler);
    return () => this.conversationRequestHandlers.delete(handler);
  }

  onConversationAccepted(handler: ConversationAcceptedHandler): () => void {
    this.conversationAcceptedHandlers.add(handler);
    return () => this.conversationAcceptedHandlers.delete(handler);
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  // ========== Emit Events ==========

  joinConversation(conversationId: string): void {
    this.socket?.emit('conversation:join', { conversationId });
  }

  leaveConversation(conversationId: string): void {
    this.socket?.emit('conversation:leave', { conversationId });
  }

  sendTypingIndicator(conversationId: string, isTyping: boolean): void {
    this.socket?.emit('typing', { conversationId, isTyping });
  }

  acknowledgeMessage(messageId: string): void {
    console.log('[realtime:ack] ✅ SENDING ACK for message', { messageId, socketId: this.socket?.id });
    this.socket?.emit('ack', { messageId });
  }

  reportMessageFailure(messageId: string, reason?: string): void {
    console.log('[realtime:nack] ❌ SENDING NACK for message', { messageId, reason, socketId: this.socket?.id });
    this.socket?.emit('nack', { messageId, reason });
  }
}

export const realtimeClient = new RealtimeClient();

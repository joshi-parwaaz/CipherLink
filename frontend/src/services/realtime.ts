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
      // Register device to receive messages
      const userId = localStorage.getItem('userId');
      const deviceId = localStorage.getItem('deviceId');
      
      if (userId && deviceId) {
        this.socket?.emit('register', { userId, deviceId });
      } else {
      }
      
      this.connectHandlers.forEach((handler) => handler());
    });

    this.socket.on('disconnect', () => {
      this.disconnectHandlers.forEach((handler) => handler());
    });

    this.socket.on('message:new', (data) => {
      // Map backend field names to frontend expectations
      const mappedData = {
        messageId: data.messageId,
        conversationId: data.convId,         // Backend sends "convId"
        senderId: data.fromUserId,            // Backend sends "fromUserId"
        ciphertext: data.ciphertext,
        nonce: data.nonce,                    // CRITICAL: needed for decryption
        aad: data.aad,                        // CRITICAL: needed for decryption
        messageNumber: data.messageNumber,    // CRITICAL: needed for ratchet
        timestamp: data.serverReceivedAt,     // Backend sends "serverReceivedAt"
      };
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

    this.socket.on('error', () => {
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
}

export const realtimeClient = new RealtimeClient();

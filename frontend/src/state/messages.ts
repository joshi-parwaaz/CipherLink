import { create } from 'zustand';
import { DecryptedMessage, Conversation } from '../types/message';

interface MessagesState {
  conversations: Conversation[];
  messages: Record<string, DecryptedMessage[]>; // conversationId -> messages
  activeConversationId: string | null;
  currentUserId: string | null;

  // Actions
  setCurrentUserId: (userId: string) => void;
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversation: (conversationId: string | null) => void;
  addMessage: (conversationId: string, message: DecryptedMessage) => void;
  updateMessageStatus: (messageId: string, status: DecryptedMessage['status']) => void;
  setMessagesForConversation: (conversationId: string, messages: DecryptedMessage[]) => void;
  incrementUnreadCount: (conversationId: string) => void;
  clearUnreadCount: (conversationId: string) => void;
}

export const useMessagesStore = create<MessagesState>((set) => ({
  conversations: [],
  messages: {},
  activeConversationId: null,
  currentUserId: null,

  setCurrentUserId: (userId) => set({ currentUserId: userId }),

  setConversations: (conversations) => set({ conversations }),

  setActiveConversation: (conversationId) =>
    set({ activeConversationId: conversationId }),

  addMessage: (conversationId, message) =>
    set((state) => {
      const existingMessages = state.messages[conversationId] || [];
      
      // Check if message already exists
      if (existingMessages.some((m) => m.id === message.id)) {
        return state;
      }

      return {
        messages: {
          ...state.messages,
          [conversationId]: [...existingMessages, message],
        },
      };
    }),

  updateMessageStatus: (messageId, status) =>
    set((state) => {
      const updatedMessages = { ...state.messages };

      Object.keys(updatedMessages).forEach((conversationId) => {
        updatedMessages[conversationId] = updatedMessages[conversationId].map(
          (msg) => (msg.id === messageId ? { ...msg, status } : msg)
        );
      });

      return { messages: updatedMessages };
    }),

  setMessagesForConversation: (conversationId, messages) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: messages,
      },
    })),

  incrementUnreadCount: (conversationId) =>
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId
          ? { ...conv, unreadCount: conv.unreadCount + 1 }
          : conv
      ),
    })),

  clearUnreadCount: (conversationId) =>
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId ? { ...conv, unreadCount: 0 } : conv
      ),
    })),
}));

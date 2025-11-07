import axios, { AxiosInstance } from 'axios';

/**
 * API client for backend communication
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

class APIClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add token to requests
    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });
  }

  setToken(token: string): void {
    this.token = token;
  }

  clearToken(): void {
    this.token = null;
  }

  // ========== Auth ==========

  async register(data: {
    username: string;
    displayName: string;
    password: string;
    identityPublicKey: string;
    encryptedIdentityPrivateKey: string;
    privateKeySalt: string;
    encryptedSignedPreKeyPrivate: string;
    signedPreKeySalt: string;
    deviceId: string;
    deviceName: string;
    signedPreKey: string;
    signedPreKeySignature: string;
    oneTimePreKeys?: string[];
  }): Promise<{
    token: string;
    user: {
      id: string;
      username: string;
      displayName: string;
      identityPublicKey: string;
    };
    device: {
      id: string;
      name: string;
    };
  }> {
    const response = await this.client.post('/auth/register', data);
    this.setToken(response.data.token);
    return response.data;
  }

  async login(data: {
    username: string;
    password: string;
  }): Promise<{
    token: string;
    deviceId: string; // Add deviceId to response type
    signedPreKeyPublic?: string; // Add signedPreKey public
    user: {
      id: string;
      username: string;
      displayName: string;
      identityPublicKey: string;
      encryptedIdentityPrivateKey: string;
      privateKeySalt: string;
      encryptedSignedPreKeyPrivate?: string;
      signedPreKeySalt?: string;
    };
  }> {
    const response = await this.client.post('/auth/login', data);
    this.setToken(response.data.token);
    return response.data;
  }

  // ========== Users ==========

  async searchUsers(query: string, limit: number = 20): Promise<
    Array<{
      id: string;
      username: string;
      displayName: string;
      identityPublicKey: string;
    }>
  > {
    const response = await this.client.get('/users/search', {
      params: { q: query, limit },
    });
    return response.data.users;
  }

  async getUserProfile(username: string): Promise<{
    id: string;
    username: string;
    displayName: string;
    identityPublicKey: string;
    createdAt: string;
  }> {
    const response = await this.client.get(`/users/${username}`);
    return response.data;
  }

  async getUserById(userId: string): Promise<{
    id: string;
    username: string;
    displayName: string;
    identityPublicKey: string;
    createdAt: string;
  }> {
    const response = await this.client.get(`/users/id/${userId}`);
    return response.data;
  }

  // ========== Conversations ==========

  async createConversation(data: {
    convId: string;
    type: 'one_to_one' | 'group';
    memberUserIds: string[];
    groupName?: string;
  }): Promise<{
    convId: string;
    type: string;
    memberUserIds: string[];
    memberDeviceIds: string[];
    groupName?: string;
    createdAt: string;
  }> {
    const response = await this.client.post('/conversations', data);
    return response.data;
  }

  async getConversation(convId: string): Promise<{
    convId: string;
    type: string;
    memberUserIds: string[];
    memberDeviceIds: string[];
    groupName?: string;
    lastMessageAt?: string;
    createdAt: string;
    updatedAt: string;
  }> {
    const response = await this.client.get(`/conversations/${convId}`);
    return response.data;
  }

  async getConversations(): Promise<{
    conversations: Array<{
      convId: string;
      type: string;
      memberUserIds: string[];
      groupName?: string;
      status: 'pending' | 'accepted' | 'rejected';
      initiatorUserId: string;
      lastMessageAt?: string;
      createdAt: string;
    }>;
  }> {
    const response = await this.client.get('/conversations');
    return response.data;
  }

  async refreshConversationDevices(convId: string): Promise<{
    memberDeviceIds: string[];
  }> {
    const response = await this.client.put(`/conversations/${convId}/devices`);
    return response.data;
  }

  async getPendingConversationRequests(): Promise<{
    pending: Array<{
      convId: string;
      type: string;
      initiatorUserId: string;
      initiatorUsername: string;
      groupName?: string;
      createdAt: string;
    }>;
  }> {
    const response = await this.client.get('/conversations/requests/pending');
    return response.data;
  }

  async acceptConversationRequest(convId: string): Promise<{
    convId: string;
    status: string;
    acceptedAt: string;
  }> {
    const response = await this.client.post(`/conversations/${convId}/accept`);
    return response.data;
  }

  async rejectConversationRequest(convId: string): Promise<{
    message: string;
  }> {
    const response = await this.client.post(`/conversations/${convId}/reject`);
    return response.data;
  }

  // ========== Messages (to be implemented in Phase 3) ==========

  async sendMessage(data: {
    messageId: string;
    convId: string;
    toDeviceIds: string[];
    aad: {
      senderId: string;
      recipientIds: string[];
      ts: string;
    };
    nonce: string;
    ciphertext: string;
    attachmentIds?: string[];
    sentAt: string;
    ttl?: string;
  }): Promise<{
    messageId: string;
    serverReceivedAt: string;
  }> {
    const response = await this.client.post('/messages', data);
    return response.data;
  }

  async getPendingMessages(deviceId: string): Promise<
    Array<{
      messageId: string;
      convId: string;
      fromUserId: string;
      fromDeviceId: string;
      toDeviceIds: string[];
      aad: {
        senderId: string;
        recipientIds: string[];
        ts: Date;
      };
      nonce: string;
      ciphertext: string;
      attachmentIds?: string[];
      sentAt: Date;
      serverReceivedAt: Date;
      ttl?: Date;
    }>
  > {
    const response = await this.client.get(`/messages/pending/${deviceId}`);
    return response.data.messages;
  }

  async sendReceipt(data: {
    messageId: string;
    status: 'delivered' | 'read';
  }): Promise<void> {
    await this.client.post('/receipts', data);
  }

  async acknowledgeMessage(messageId: string): Promise<void> {
    await this.client.post('/messages/ack', { messageId });
  }

  async reportMessageFailure(messageId: string, reason?: string): Promise<void> {
    await this.client.post('/messages/nack', { messageId, reason });
  }

  /**
   * Get message history for a conversation (encrypted)
   * Returns all messages (pending, delivered, etc.) for persistent history
   */
  async getConversationMessages(
    convId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    messages: Array<{
      messageId: string;
      convId: string;
      fromUserId: string;
      fromDeviceId: string;
      ciphertext: string;
      nonce: string;
      aad: {
        senderId: string;
        recipientIds: string[];
        ts: Date;
      };
      messageNumber?: number;
      sentAt: Date;
      serverReceivedAt: Date;
      status: string;
    }>;
    total: number;
    hasMore: boolean;
  }> {
    const response = await this.client.get(
      `/messages/conversation/${convId}`,
      { params: { limit, offset } }
    );
    return response.data;
  }

  // ========== Devices (to be implemented in Phase 4) ==========

  async getDevices(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      lastSeenAt: string;
    }>
  > {
    const response = await this.client.get(`/devices/${userId}`);
    return response.data.devices;
  }

  async getPreKeyBundle(userId: string, deviceId: string): Promise<{
    identityKey: string;
    signedPreKey: string;
    signedPreKeySignature: string;
    oneTimePreKey?: string;
  }> {
    const response = await this.client.get(`/devices/${userId}/${deviceId}/prekeys`);
    return response.data;
  }

  // ========== Attachments (to be implemented in Phase 3) ==========

  async uploadAttachment(
    conversationId: string,
    encryptedBlob: Blob,
    encryptedMetadata: string
  ): Promise<{ attachmentId: string }> {
    const formData = new FormData();
    formData.append('conversationId', conversationId);
    formData.append('file', encryptedBlob);
    formData.append('metadata', encryptedMetadata);

    const response = await this.client.post('/attachments/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data;
  }

  async downloadAttachment(attachmentId: string): Promise<{
    blob: Blob;
    metadata: string;
  }> {
    const response = await this.client.get(`/attachments/${attachmentId}`, {
      responseType: 'blob',
    });

    const metadata = response.headers['x-encrypted-metadata'] || '';

    return {
      blob: response.data,
      metadata,
    };
  }
}

export const apiClient = new APIClient();

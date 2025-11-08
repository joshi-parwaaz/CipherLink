/**
 * Jest setup file for frontend tests
 */

// Mock the crypto API for libsodium
Object.defineProperty(window, 'crypto', {
  value: {
    getRandomValues: (array: Uint8Array) => {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
    subtle: {
      // Add any subtle crypto methods if needed
    },
  },
});

// Mock localStorage
const localStorageMock = {
  getItem: (global as any).jest.fn(),
  setItem: (global as any).jest.fn(),
  removeItem: (global as any).jest.fn(),
  clear: (global as any).jest.fn(),
  length: 0,
  key: (global as any).jest.fn(),
};
global.localStorage = localStorageMock as any;

// Mock WebSocket
global.WebSocket = (global as any).jest.fn().mockImplementation(() => ({
  addEventListener: (global as any).jest.fn(),
  removeEventListener: (global as any).jest.fn(),
  dispatchEvent: (global as any).jest.fn(),
  send: (global as any).jest.fn(),
  close: (global as any).jest.fn(),
  readyState: 1,
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
}));

// Mock fetch if needed
global.fetch = (global as any).jest.fn();

// Mock ResizeObserver
global.ResizeObserver = (global as any).jest.fn().mockImplementation(() => ({
  observe: (global as any).jest.fn(),
  unobserve: (global as any).jest.fn(),
  disconnect: (global as any).jest.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = (global as any).jest.fn().mockImplementation(() => ({
  observe: (global as any).jest.fn(),
  unobserve: (global as any).jest.fn(),
  disconnect: (global as any).jest.fn(),
}));
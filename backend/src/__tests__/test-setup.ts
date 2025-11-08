/**
 * Test Database Setup Utility
 * Manages MongoDB connections for tests to avoid connection conflicts
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer: MongoMemoryServer;
let isConnected = false;

/**
 * Setup in-memory MongoDB for tests
 */
export async function setupTestDB(): Promise<void> {
  if (isConnected) {
    return; // Already connected
  }

  try {
    // start in-memory MongoDB for tests
    mongoServer = await MongoMemoryServer.create({ instance: { dbName: 'testdb' } });
    const mongoUri = mongoServer.getUri();

    // Connect to the in-memory database with a shorter selection timeout
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });

    isConnected = true;
  } catch (error) {
    console.error('Failed to setup test database:', error);
    throw error;
  }
}

/**
 * Teardown test database
 */
export async function teardownTestDB(): Promise<void> {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
    isConnected = false;
  } catch (error) {
    console.error('Failed to teardown test database:', error);
    throw error;
  }
}

/**
 * Clear all collections in the test database
 */
export async function clearTestDB(): Promise<void> {
  try {
    // If not connected, skip drop
    if (mongoose.connection.readyState !== 1) return;

    await mongoose.connection.dropDatabase();
  } catch (error) {
    console.error('Failed to clear test database:', error);
    // Don't throw error if database doesn't exist or connection is down
  }
}
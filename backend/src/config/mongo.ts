import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import { config } from './index.js';

let isConnected = false;

export async function connectToMongo(): Promise<void> {
  if (isConnected) {
    logger.info('Using existing MongoDB connection');
    return;
  }

  try {
    await mongoose.connect(config.mongoUri);
    isConnected = true;
    logger.info('MongoDB connected successfully');

    mongoose.connection.on('error', (err) => {
      logger.error({ err }, 'MongoDB connection error');
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
      isConnected = false;
    });
  } catch (err) {
    logger.error({ err }, 'Failed to connect to MongoDB');
    throw err;
  }
}

export async function disconnectFromMongo(): Promise<void> {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('MongoDB disconnected successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to disconnect from MongoDB');
    throw err;
  }
}

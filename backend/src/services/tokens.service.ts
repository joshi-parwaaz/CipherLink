import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export interface TokenPayload {
  userId: string;
  deviceId: string;
  username: string;
}

export function generateToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: '7d',
    issuer: 'cyphertext-api',
  });
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      issuer: 'cyphertext-api',
    }) as TokenPayload;
    return decoded;
  } catch (err) {
    throw new Error('Invalid or expired token');
  }
}

export function decodeToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.decode(token) as TokenPayload;
    return decoded;
  } catch (err) {
    return null;
  }
}

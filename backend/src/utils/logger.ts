import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    env: process.env.NODE_ENV || 'development',
  },
  // Meta-only: no plaintext, no ciphertext, no user PII beyond IDs/timestamps
  redact: {
    paths: ['req.headers.authorization', 'password', 'token'],
    censor: '[REDACTED]',
  },
});

export default logger;

/**
 * Telemetry service for meta-only logging
 * Complies with constitution: NO plaintext, ciphertext, or PII
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface TelemetryEvent {
  level: LogLevel;
  category: string;
  action: string;
  metadata?: Record<string, string | number | boolean>;
  timestamp: number;
}

class TelemetryService {
  private events: TelemetryEvent[] = [];
  private maxEvents = 1000;

  log(
    level: LogLevel,
    category: string,
    action: string,
    metadata?: Record<string, string | number | boolean>
  ): void {
    const event: TelemetryEvent = {
      level,
      category,
      action,
      metadata,
      timestamp: Date.now(),
    };

    this.events.push(event);

    // Keep only recent events
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // Log to console in development
    if (import.meta.env.DEV) {
      const emoji = this.getEmojiForLevel(level);
    }
  }

  info(category: string, action: string, metadata?: Record<string, string | number | boolean>): void {
    this.log('info', category, action, metadata);
  }

  warn(category: string, action: string, metadata?: Record<string, string | number | boolean>): void {
    this.log('warn', category, action, metadata);
  }

  error(category: string, action: string, metadata?: Record<string, string | number | boolean>): void {
    this.log('error', category, action, metadata);
  }

  debug(category: string, action: string, metadata?: Record<string, string | number | boolean>): void {
    this.log('debug', category, action, metadata);
  }

  getRecentEvents(limit: number = 100): TelemetryEvent[] {
    return this.events.slice(-limit);
  }

  clearEvents(): void {
    this.events = [];
  }

  private getEmojiForLevel(level: LogLevel): string {
    switch (level) {
      case 'info':
        return 'ℹ️';
      case 'warn':
        return '⚠️';
      case 'error':
        return '❌';
      case 'debug':
        return '🐛';
      default:
        return '📝';
    }
  }
}

export const telemetry = new TelemetryService();

// Convenience exports
export const logCrypto = (action: string, metadata?: Record<string, string | number | boolean>) =>
  telemetry.info('crypto', action, metadata);

export const logAuth = (action: string, metadata?: Record<string, string | number | boolean>) =>
  telemetry.info('auth', action, metadata);

export const logMessage = (action: string, metadata?: Record<string, string | number | boolean>) =>
  telemetry.info('message', action, metadata);

export const logStorage = (action: string, metadata?: Record<string, string | number | boolean>) =>
  telemetry.info('storage', action, metadata);

export const logNetwork = (action: string, metadata?: Record<string, string | number | boolean>) =>
  telemetry.info('network', action, metadata);

import Redis from 'ioredis';
import { config } from '../config.js';

// Shared connection for general commands (non-pub/sub)
let _sharedRedis: Redis | null = null;

export function getRedis(): Redis {
  if (!_sharedRedis) {
    _sharedRedis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    _sharedRedis.on('error', () => {
      // Errors are expected during reconnect; ioredis handles retry internally.
    });
  }
  return _sharedRedis;
}

/** Create a dedicated Redis client for pub/sub (cannot share with commands). */
export function createSubscriber(): Redis {
  const sub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  sub.on('error', () => {});
  return sub;
}

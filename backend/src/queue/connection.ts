import { Redis } from 'ioredis';

import env from '../config/env.js';

/** Shared connection factory — BullMQ requires maxRetriesPerRequest: null */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

let sharedConnection: Redis | null = null;

/** Lazy shared connection for non-BullMQ uses (OAuth state, locks) */
export function getRedis(): Redis {
  if (!sharedConnection) sharedConnection = new Redis(env.REDIS_URL);
  return sharedConnection;
}

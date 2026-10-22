import type { UserDto } from '@food/shared';
import {
  SESSION_CACHE_MAX_ENTRIES,
  SESSION_CACHE_TTL_MS,
} from './auth.constants.js';

export interface CachedSession {
  sessionId: string;
  user: UserDto;
  lastSeenAt: Date;
}

interface CacheSlot {
  value: CachedSession;
  expiresAt: number;
}

export class SessionCache {
  private readonly slots = new Map<string, CacheSlot>();

  constructor(
    private readonly ttlMs = SESSION_CACHE_TTL_MS,
    private readonly maxEntries = SESSION_CACHE_MAX_ENTRIES,
  ) {}

  get size(): number {
    return this.slots.size;
  }

  get(sessionId: string, nowMs: number): CachedSession | null {
    const slot = this.slots.get(sessionId);
    if (!slot) {
      return null;
    }
    if (slot.expiresAt <= nowMs) {
      this.slots.delete(sessionId);
      return null;
    }
    return slot.value;
  }

  set(value: CachedSession, nowMs: number): void {
    this.slots.delete(value.sessionId);
    while (this.slots.size >= this.maxEntries) {
      const oldest = this.slots.keys().next();
      if (oldest.done) {
        break;
      }
      this.slots.delete(oldest.value);
    }
    this.slots.set(value.sessionId, { value, expiresAt: nowMs + this.ttlMs });
  }

  delete(sessionId: string): void {
    this.slots.delete(sessionId);
  }

  deleteUser(userId: string): void {
    for (const [sessionId, slot] of this.slots) {
      if (slot.value.user.id === userId) {
        this.slots.delete(sessionId);
      }
    }
  }

  clear(): void {
    this.slots.clear();
  }
}

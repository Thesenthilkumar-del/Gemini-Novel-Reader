export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests allowed in the window
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface RateLimitInfo {
  success: boolean;
  remaining: number;
  total: number;
  resetTime: Date;
  retryAfter?: number;
}

export interface RateLimitStore {
  get(key: string): { count: number; resetTime: number } | null;
  set(key: string, value: { count: number; resetTime: number }): void;
  delete(key: string): void;
}

// In-memory store for rate limiting
class MemoryStore implements RateLimitStore {
  private store = new Map<string, { count: number; resetTime: number }>();

  get(key: string): { count: number; resetTime: number } | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check if the window has expired
    if (Date.now() > entry.resetTime) {
      this.store.delete(key);
      return null;
    }

    return entry;
  }

  set(key: string, value: { count: number; resetTime: number }): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  // Cleanup expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }
}

export class RateLimiter {
  private store: RateLimitStore;
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig, store?: RateLimitStore) {
    this.config = config;
    this.store = store || new MemoryStore();
    
    // Periodic cleanup for memory store
    if (this.store instanceof MemoryStore) {
      setInterval(() => (this.store as MemoryStore).cleanup(), Math.min(config.windowMs, 60000)).unref();
    }
  }

  /**
   * Check if the request is within rate limits
   */
  check(key: string): RateLimitInfo {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    
    const entry = this.store.get(key);
    
    if (!entry) {
      // First request in this window
      this.store.set(key, {
        count: 1,
        resetTime: now + this.config.windowMs
      });
      
      return {
        success: true,
        remaining: this.config.maxRequests - 1,
        total: this.config.maxRequests,
        resetTime: new Date(now + this.config.windowMs)
      };
    }

    if (now > entry.resetTime) {
      // Window has expired, reset
      this.store.set(key, {
        count: 1,
        resetTime: now + this.config.windowMs
      });
      
      return {
        success: true,
        remaining: this.config.maxRequests - 1,
        total: this.config.maxRequests,
        resetTime: new Date(now + this.config.windowMs)
      };
    }

    if (entry.count >= this.config.maxRequests) {
      // Rate limit exceeded
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      
      return {
        success: false,
        remaining: 0,
        total: this.config.maxRequests,
        resetTime: new Date(entry.resetTime),
        retryAfter
      };
    }

    // Within limits, increment counter
    entry.count++;
    this.store.set(key, entry);

    return {
      success: true,
      remaining: this.config.maxRequests - entry.count,
      total: this.config.maxRequests,
      resetTime: new Date(entry.resetTime)
    };
  }

  /**
   * Create a key based on IP and endpoint for rate limiting
   */
  static createKey(ip: string, endpoint: string): string {
    return `${ip}:${endpoint}`;
  }
}

// Default rate limiters
export const rateLimiters = {
  // 10 requests per minute
  perMinute: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10
  }),
  
  // 100 requests per day
  perDay: new RateLimiter({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    maxRequests: 100
  })
};

/**
 * Middleware function to check rate limits
 */
export function checkRateLimit(
  ip: string, 
  endpoint: string
): RateLimitInfo {
  const key = RateLimiter.createKey(ip, endpoint);
  
  // Check both per-minute and per-day limits
  const minuteCheck = rateLimiters.perMinute.check(key);
  const dayKey = `${key}:daily`;
  const dayCheck = rateLimiters.perDay.check(dayKey);
  
  // Return the more restrictive result
  if (!minuteCheck.success) {
    return minuteCheck;
  }
  
  if (!dayCheck.success) {
    return dayCheck;
  }
  
  // Return the one with fewer remaining requests
  return minuteCheck.remaining <= dayCheck.remaining ? minuteCheck : dayCheck;
}
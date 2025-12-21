import crypto from 'crypto';

export interface CacheConfig {
  ttl: number; // Time to live in milliseconds
  maxSize?: number; // Maximum number of entries (for memory store)
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, data: T, ttl: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

// In-memory cache implementation
class MemoryCache implements CacheStore {
  private store = new Map<string, CacheEntry<any>>();
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.timestamp + entry.ttl) {
      // Expired, remove it
      this.store.delete(key);
      return null;
    }

    return entry as CacheEntry<T>;
  }

  async set<T>(key: string, data: T, ttl: number): Promise<void> {
    // If at capacity, remove oldest entries (simple LRU)
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  // Cleanup expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.timestamp + entry.ttl) {
        this.store.delete(key);
      }
    }
  }
}

// Cache entry types
export interface TranslationCache {
  originalText: string;
  translatedText: string;
  model: string;
  timestamp: number;
}

export interface ScrapeCache {
  content: string;
  sourceUrl: string;
  timestamp: number;
}

export class Cache {
  private store: CacheStore;
  private translationTTL: number;
  private scrapeTTL: number;

  constructor(
    store?: CacheStore,
    config: { translationTTL?: number; scrapeTTL?: number } = {}
  ) {
    this.store = store || new MemoryCache();
    this.translationTTL = config.translationTTL || 7 * 24 * 60 * 60 * 1000; // 7 days
    this.scrapeTTL = config.scrapeTTL || 24 * 60 * 60 * 1000; // 24 hours
    
    // Periodic cleanup for memory store
    if (this.store instanceof MemoryCache) {
      setInterval(() => (this.store as MemoryCache).cleanup?.(), Math.min(this.scrapeTTL, 60000)).unref();
    }
  }

  /**
   * Generate a cache key for translation
   */
  generateTranslationKey(sourceUrl: string, chapterNumber: string, originalText: string): string {
    const data = `${sourceUrl}:${chapterNumber}:${originalText}`;
    return `translation:${crypto.createHash('sha256').update(data).digest('hex')}`;
  }

  /**
   * Generate a cache key for scraping
   */
  generateScrapeKey(sourceUrl: string): string {
    return `scrape:${crypto.createHash('sha256').update(sourceUrl).digest('hex')}`;
  }

  /**
   * Get cached translation
   */
  async getTranslation(
    sourceUrl: string,
    chapterNumber: string,
    originalText: string
  ): Promise<TranslationCache | null> {
    const key = this.generateTranslationKey(sourceUrl, chapterNumber, originalText);
    const entry = await this.store.get<TranslationCache>(key);
    return entry?.data || null;
  }

  /**
   * Set cached translation
   */
  async setTranslation(
    sourceUrl: string,
    chapterNumber: string,
    originalText: string,
    translation: string,
    model: string
  ): Promise<void> {
    const key = this.generateTranslationKey(sourceUrl, chapterNumber, originalText);
    const cacheData: TranslationCache = {
      originalText,
      translatedText: translation,
      model,
      timestamp: Date.now()
    };
    
    await this.store.set(key, cacheData, this.translationTTL);
  }

  /**
   * Get cached scrape result
   */
  async getScrape(sourceUrl: string): Promise<ScrapeCache | null> {
    const key = this.generateScrapeKey(sourceUrl);
    const entry = await this.store.get<ScrapeCache>(key);
    return entry?.data || null;
  }

  /**
   * Set cached scrape result
   */
  async setScrape(sourceUrl: string, content: string, customTtl?: number): Promise<void> {
    const key = this.generateScrapeKey(sourceUrl);
    const cacheData: ScrapeCache = {
      content,
      sourceUrl,
      timestamp: Date.now()
    };
    
    await this.store.set(key, cacheData, this.scrapeTTL);
  }

  /**
   * Clear all cached data
   */
  async clear(): Promise<void> {
    await this.store.clear();
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ totalEntries: number; translationEntries: number; scrapeEntries: number }> {
    if (!(this.store instanceof MemoryCache)) {
      return { totalEntries: 0, translationEntries: 0, scrapeEntries: 0 };
    }

    const store = (this.store as any).store;
    let translationEntries = 0;
    let scrapeEntries = 0;

    for (const key of store.keys()) {
      if (key.startsWith('translation:')) {
        translationEntries++;
      } else if (key.startsWith('scrape:')) {
        scrapeEntries++;
      }
    }

    return {
      totalEntries: store.size,
      translationEntries,
      scrapeEntries
    };
  }
}

// Global cache instance
export const cache = new Cache();

// Helper functions for quick access
export const cacheHelpers = {
  /**
   * Check if content size is within limits (1MB)
   */
  isValidContentSize(content: string): boolean {
    const sizeInBytes = new Blob([content]).size;
    return sizeInBytes <= 1 * 1024 * 1024; // 1MB
  },

  /**
   * Get content size in bytes
   */
  getContentSize(content: string): number {
    return new Blob([content]).size;
  }
};
// Zero-Latency IndexedDB Storage Layer for Gemini Novel Reader
// Provides instant chapter loading and offline reading capabilities

export interface ChapterRecord {
  // Primary key (URL hash)
  id: string;
  
  // Metadata
  sourceUrl: string;
  chapterNumber?: number;
  title: string;
  
  // Content
  originalMarkdown: string;
  translatedText: string;
  
  // Timestamps
  createdAt: number;
  updatedAt: number;
  lastAccessed: number;
  
  // Reading progress
  readingProgress: {
    position: number; // character position
    percentage: number; // 0-100
    scrollY: number;
    scrollHeight: number;
  };
  
  // Navigation
  nextUrl?: string;
  prevUrl?: string;
  
  // Novel metadata
  novelTitle?: string;
  novelAuthor?: string;
}

export interface ReadingHistory {
  id: string;
  chapterId: string;
  chapterTitle: string;
  sourceUrl: string;
  lastRead: number;
  readingTime: number; // seconds
  completed: boolean;
}

export interface StorageStats {
  totalChapters: number;
  totalHistoryRecords: number;
  storageUsed: number; // bytes
  storageQuota: number; // bytes
  oldestChapter: number;
  newestChapter: number;
}

export class ChapterStorage {
  private db: IDBDatabase | null = null;
  private dbName = 'GeminiNovelReader';
  private dbVersion = 1;
  private broadcastChannel: BroadcastChannel | null = null;
  private storageQuotaWarningThreshold = 0.9; // 90%

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Chapters store
        if (!db.objectStoreNames.contains('chapters')) {
          const chaptersStore = db.createObjectStore('chapters', { keyPath: 'id' });
          chaptersStore.createIndex('sourceUrl', 'sourceUrl', { unique: true });
          chaptersStore.createIndex('createdAt', 'createdAt', { unique: false });
          chaptersStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
          chaptersStore.createIndex('chapterNumber', 'chapterNumber', { unique: false });
        }

        // Reading history store
        if (!db.objectStoreNames.contains('readingHistory')) {
          const historyStore = db.createObjectStore('readingHistory', { keyPath: 'id' });
          historyStore.createIndex('chapterId', 'chapterId', { unique: false });
          historyStore.createIndex('lastRead', 'lastRead', { unique: false });
        }

        // Settings store for user preferences
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
    });
  }

  async ensureInitialized(): Promise<void> {
    if (!this.db) {
      await this.initialize();
      this.setupCrossTabSync();
    }
  }

  // CRUD Operations
  async createChapter(record: Omit<ChapterRecord, 'id' | 'createdAt' | 'updatedAt' | 'lastAccessed' | 'readingProgress'>): Promise<string> {
    await this.ensureInitialized();
    
    const id = await this.generateChapterId(record.sourceUrl);
    const now = Date.now();
    
    const chapterRecord: ChapterRecord = {
      ...record,
      id,
      createdAt: now,
      updatedAt: now,
      lastAccessed: now,
      readingProgress: {
        position: 0,
        percentage: 0,
        scrollY: 0,
        scrollHeight: 0
      }
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chapters'], 'readwrite');
      const store = transaction.objectStore('chapters');
      
      const request = store.add(chapterRecord);
      
      request.onsuccess = () => {
        this.broadcastChange('chapterCreated', { id, chapter: chapterRecord });
        resolve(id);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async getChapter(id: string): Promise<ChapterRecord | null> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chapters'], 'readonly');
      const store = transaction.objectStore('chapters');
      
      const request = store.get(id);
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          // Update last accessed time
          result.lastAccessed = Date.now();
          store.put(result);
        }
        resolve(result || null);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async getChapterByUrl(sourceUrl: string): Promise<ChapterRecord | null> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chapters'], 'readonly');
      const store = transaction.objectStore('chapters');
      const index = store.index('sourceUrl');
      
      const request = index.get(sourceUrl);
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          // Update last accessed time
          result.lastAccessed = Date.now();
          store.put(result);
        }
        resolve(result || null);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async updateChapter(id: string, updates: Partial<ChapterRecord>): Promise<void> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chapters'], 'readwrite');
      const store = transaction.objectStore('chapters');
      
      // First get the existing record
      const getRequest = store.get(id);
      
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (!existing) {
          reject(new Error('Chapter not found'));
          return;
        }
        
        // Merge updates
        const updated = {
          ...existing,
          ...updates,
          id, // Ensure ID doesn't change
          createdAt: existing.createdAt, // Preserve creation time
          updatedAt: Date.now()
        };
        
        const putRequest = store.put(updated);
        
        putRequest.onsuccess = () => {
          this.broadcastChange('chapterUpdated', { id, chapter: updated });
          resolve();
        };
        
        putRequest.onerror = () => reject(putRequest.error);
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async updateReadingProgress(id: string, progress: Partial<ChapterRecord['readingProgress']>): Promise<void> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chapters'], 'readwrite');
      const store = transaction.objectStore('chapters');
      
      const getRequest = store.get(id);
      
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (!existing) {
          reject(new Error('Chapter not found'));
          return;
        }
        
        existing.readingProgress = {
          ...existing.readingProgress,
          ...progress
        };
        existing.lastAccessed = Date.now();
        
        const putRequest = store.put(existing);
        
        putRequest.onsuccess = () => {
          // Also update reading history
          this.addToReadingHistory(existing.id, existing.title, existing.sourceUrl, progress.percentage || 0);
          resolve();
        };
        
        putRequest.onerror = () => reject(putRequest.error);
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async deleteChapter(id: string): Promise<void> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chapters', 'readingHistory'], 'readwrite');
      const chaptersStore = transaction.objectStore('chapters');
      const historyStore = transaction.objectStore('readingHistory');
      
      // Delete chapter and its history records
      const deleteChapterRequest = chaptersStore.delete(id);
      
      deleteChapterRequest.onsuccess = () => {
        // Delete related history records
        const historyIndex = historyStore.index('chapterId');
        const historyCursorRequest = historyIndex.openCursor(id);
        
        historyCursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            historyStore.delete(cursor.primaryKey);
            cursor.continue();
          } else {
            this.broadcastChange('chapterDeleted', { id });
            resolve();
          }
        };
      };
      
      deleteChapterRequest.onerror = () => reject(deleteChapterRequest.error);
    });
  }

  async getAllChapters(): Promise<ChapterRecord[]> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chapters'], 'readonly');
      const store = transaction.objectStore('chapters');
      
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.lastAccessed - a.lastAccessed));
      request.onerror = () => reject(request.error);
    });
  }

  async getChaptersByNovel(novelTitle?: string): Promise<ChapterRecord[]> {
    const allChapters = await this.getAllChapters();
    
    if (!novelTitle) return allChapters;
    
    return allChapters.filter(chapter => 
      chapter.novelTitle?.toLowerCase().includes(novelTitle.toLowerCase())
    );
  }

  // Reading History
  async addToReadingHistory(chapterId: string, chapterTitle: string, sourceUrl: string, readingPercentage: number): Promise<void> {
    await this.ensureInitialized();
    
    const id = `${chapterId}_${Date.now()}`;
    const now = Date.now();
    
    const historyRecord: ReadingHistory = {
      id,
      chapterId,
      chapterTitle,
      sourceUrl,
      lastRead: now,
      readingTime: 0, // Will be updated by client
      completed: readingPercentage >= 95
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['readingHistory'], 'readwrite');
      const store = transaction.objectStore('readingHistory');
      
      const request = store.add(historyRecord);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getReadingHistory(limit = 50): Promise<ReadingHistory[]> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['readingHistory'], 'readonly');
      const store = transaction.objectStore('readingHistory');
      const index = store.index('lastRead');
      
      const request = index.openCursor(null, 'prev'); // Descending order
      const results: ReadingHistory[] = [];
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  // Cleanup and Maintenance
  async cleanupOldChapters(daysToKeep = 30): Promise<number> {
    await this.ensureInitialized();
    
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    let deletedCount = 0;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chapters', 'readingHistory'], 'readwrite');
      const chaptersStore = transaction.objectStore('chapters');
      const historyStore = transaction.objectStore('readingHistory');
      
      const chaptersIndex = chaptersStore.index('lastAccessed');
      const historyIndex = historyStore.index('lastRead');
      
      // Delete old chapters
      const chaptersCursorRequest = chaptersIndex.openCursor(IDBKeyRange.upperBound(cutoffTime));
      
      chaptersCursorRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          chaptersStore.delete(cursor.primaryKey);
          deletedCount++;
          cursor.continue();
        }
      };
      
      transaction.oncomplete = () => resolve(deletedCount);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Storage Management
  async getStorageStats(): Promise<StorageStats> {
    await this.ensureInitialized();
    
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      
      return {
        totalChapters: await this.getChapterCount(),
        totalHistoryRecords: await this.getHistoryCount(),
        storageUsed: estimate.usage || 0,
        storageQuota: estimate.quota || 0,
        oldestChapter: await this.getOldestChapterTime(),
        newestChapter: await this.getNewestChapterTime()
      };
    }
    
    // Fallback without storage estimation API
    return {
      totalChapters: await this.getChapterCount(),
      totalHistoryRecords: await this.getHistoryCount(),
      storageUsed: 0,
      storageQuota: 0,
      oldestChapter: await this.getOldestChapterTime(),
      newestChapter: await this.getNewestChapterTime()
    };
  }

  async checkStorageQuota(): Promise<{ usage: number; quota: number; percentage: number; isWarning: boolean }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const percentage = quota > 0 ? usage / quota : 0;
      
      return {
        usage,
        quota,
        percentage,
        isWarning: percentage >= this.storageQuotaWarningThreshold
      };
    }
    
    return { usage: 0, quota: 0, percentage: 0, isWarning: false };
  }

  // Cross-tab synchronization
  setupCrossTabSync(): void {
    if (typeof BroadcastChannel !== 'undefined') {
      this.broadcastChannel = new BroadcastChannel('novel-reader-storage');
    }
  }

  private broadcastChange(type: string, data: any): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type, data, timestamp: Date.now() });
    }
  }

  onStorageChange(callback: (type: string, data: any) => void): () => void {
    if (!this.broadcastChannel) return () => {};
    
    const handler = (event: MessageEvent) => {
      callback(event.data.type, event.data.data);
    };
    
    this.broadcastChannel.addEventListener('message', handler);
    
    return () => {
      this.broadcastChannel?.removeEventListener('message', handler);
    };
  }

  // Utility methods
  private async generateChapterId(sourceUrl: string): Promise<string> {
    // Create a hash-like ID from the URL for consistency
    let hash = 0;
    for (let i = 0; i < sourceUrl.length; i++) {
      const char = sourceUrl.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private async getChapterCount(): Promise<number> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chapters'], 'readonly');
      const store = transaction.objectStore('chapters');
      const request = store.count();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async getHistoryCount(): Promise<number> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['readingHistory'], 'readonly');
      const store = transaction.objectStore('readingHistory');
      const request = store.count();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async getOldestChapterTime(): Promise<number> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chapters'], 'readonly');
      const store = transaction.objectStore('chapters');
      const index = store.index('createdAt');
      const request = index.openCursor();
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          resolve(cursor.value.createdAt);
        } else {
          resolve(0);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  private async getNewestChapterTime(): Promise<number> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chapters'], 'readonly');
      const store = transaction.objectStore('chapters');
      const index = store.index('createdAt');
      const request = index.openCursor(null, 'prev');
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          resolve(cursor.value.createdAt);
        } else {
          resolve(0);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }
}

// Singleton instance
export const chapterStorage = new ChapterStorage();
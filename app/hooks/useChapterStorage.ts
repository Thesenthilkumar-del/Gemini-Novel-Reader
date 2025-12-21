// React Hook for Zero-Latency Chapter Storage
// Provides instant access to IndexedDB-backed chapter management

import { useState, useEffect, useCallback, useRef } from 'react';
import { chapterStorage, type ChapterRecord, type ReadingHistory, type StorageStats } from '../lib/indexed-db';

interface UseChapterStorageOptions {
  autoCleanup?: boolean;
  cleanupDays?: number;
  trackProgress?: boolean;
}

interface UseChapterStorageReturn {
  // Core data
  chapters: ChapterRecord[];
  history: ReadingHistory[];
  storageStats: StorageStats | null;
  
  // Loading states
  isLoading: boolean;
  isInitialized: boolean;
  
  // CRUD operations
  saveChapter: (data: {
    sourceUrl: string;
    chapterNumber?: number;
    title: string;
    originalMarkdown: string;
    translatedText: string;
    nextUrl?: string;
    prevUrl?: string;
    novelTitle?: string;
    novelAuthor?: string;
  }) => Promise<string>;
  
  loadChapter: (sourceUrl: string) => Promise<ChapterRecord | null>;
  updateChapter: (id: string, updates: Partial<ChapterRecord>) => Promise<void>;
  deleteChapter: (id: string) => Promise<void>;
  
  // Reading progress
  updateProgress: (chapterId: string, progress: {
    position?: number;
    percentage?: number;
    scrollY?: number;
    scrollHeight?: number;
  }) => Promise<void>;
  
  // History and search
  searchChapters: (query: string) => ChapterRecord[];
  sortChapters: (sortBy: 'lastAccessed' | 'createdAt' | 'title' | 'chapterNumber') => ChapterRecord[];
  
  // Utilities
  refreshData: () => Promise<void>;
  clearAllData: () => Promise<void>;
  
  // Storage management
  exportLibrary: () => Promise<{ data: string; filename: string }>;
  importLibrary: (jsonData: string) => Promise<{ importedChapters: number; skippedChapters: number; errors: string[] }>;
  cleanupOldChapters: () => Promise<number>;
  
  // Real-time sync
  isSynced: boolean;
}

export function useChapterStorage(options: UseChapterStorageOptions = {}): UseChapterStorageReturn {
  const {
    autoCleanup = true,
    cleanupDays = 30,
    trackProgress = true
  } = options;

  // State
  const [chapters, setChapters] = useState<ChapterRecord[]>([]);
  const [history, setHistory] = useState<ReadingHistory[]>([]);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSynced, setIsSynced] = useState(false);

  // Refs for performance
  const mounted = useRef(true);
  const lastSync = useRef(0);

  // Initialize database and load initial data
  useEffect(() => {
    const initialize = async () => {
      try {
        setIsLoading(true);
        await chapterStorage.initialize();
        setIsInitialized(true);
        
        // Load initial data
        await refreshData();
        
        // Setup cross-tab sync
        const unsubscribe = chapterStorage.onStorageChange(async (type, data) => {
          const now = Date.now();
          // Prevent rapid successive updates (throttle to 100ms)
          if (now - lastSync.current < 100) return;
          
          setIsSynced(true);
          await refreshData();
          setTimeout(() => setIsSynced(false), 500);
          lastSync.current = now;
        });
        
        // Periodic cleanup
        if (autoCleanup) {
          const cleanupInterval = setInterval(() => {
            cleanupOldChapters().catch(console.error);
          }, 24 * 60 * 60 * 1000); // Daily cleanup
          
          return () => {
            unsubscribe();
            clearInterval(cleanupInterval);
            mounted.current = false;
          };
        }
        
        return unsubscribe;
      } catch (error) {
        console.error('Failed to initialize chapter storage:', error);
      } finally {
        if (mounted.current) {
          setIsLoading(false);
        }
      }
    };

    initialize();
  }, [autoCleanup, cleanupDays]);

  // Refresh all data
  const refreshData = useCallback(async () => {
    if (!isInitialized) return;
    
    try {
      const [chaptersData, historyData, stats] = await Promise.all([
        chapterStorage.getAllChapters(),
        chapterStorage.getReadingHistory(100),
        chapterStorage.getStorageStats()
      ]);
      
      if (mounted.current) {
        setChapters(chaptersData);
        setHistory(historyData);
        setStorageStats(stats);
      }
    } catch (error) {
      console.error('Failed to refresh data:', error);
    }
  }, [isInitialized]);

  // Save chapter with automatic progress tracking
  const saveChapter = useCallback(async (data: {
    sourceUrl: string;
    chapterNumber?: number;
    title: string;
    originalMarkdown: string;
    translatedText: string;
    nextUrl?: string;
    prevUrl?: string;
    novelTitle?: string;
    novelAuthor?: string;
  }): Promise<string> => {
    try {
      // Check if chapter already exists
      const existing = await chapterStorage.getChapterByUrl(data.sourceUrl);
      
      if (existing) {
        // Update existing chapter
        await chapterStorage.updateChapter(existing.id, data);
        return existing.id;
      } else {
        // Create new chapter
        const id = await chapterStorage.createChapter(data);
        return id;
      }
    } catch (error) {
      console.error('Failed to save chapter:', error);
      throw error;
    }
  }, []);

  // Load chapter with instant access
  const loadChapter = useCallback(async (sourceUrl: string): Promise<ChapterRecord | null> => {
    try {
      const chapter = await chapterStorage.getChapterByUrl(sourceUrl);
      if (chapter) {
        // Update access time
        await chapterStorage.updateChapter(chapter.id, { lastAccessed: Date.now() });
      }
      return chapter;
    } catch (error) {
      console.error('Failed to load chapter:', error);
      return null;
    }
  }, []);

  // Update chapter
  const updateChapter = useCallback(async (id: string, updates: Partial<ChapterRecord>): Promise<void> => {
    try {
      await chapterStorage.updateChapter(id, updates);
    } catch (error) {
      console.error('Failed to update chapter:', error);
      throw error;
    }
  }, []);

  // Update reading progress
  const updateProgress = useCallback(async (chapterId: string, progress: {
    position?: number;
    percentage?: number;
    scrollY?: number;
    scrollHeight?: number;
  }): Promise<void> => {
    try {
      if (trackProgress) {
        await chapterStorage.updateReadingProgress(chapterId, progress);
      }
    } catch (error) {
      console.error('Failed to update progress:', error);
      throw error;
    }
  }, [trackProgress]);

  // Delete chapter
  const deleteChapter = useCallback(async (id: string): Promise<void> => {
    try {
      await chapterStorage.deleteChapter(id);
      // Refresh data after deletion
      await refreshData();
    } catch (error) {
      console.error('Failed to delete chapter:', error);
      throw error;
    }
  }, [refreshData]);

  // Search functionality
  const searchChapters = useCallback((query: string): ChapterRecord[] => {
    if (!query.trim()) return chapters;
    
    const lowercaseQuery = query.toLowerCase();
    return chapters.filter(chapter =>
      chapter.title.toLowerCase().includes(lowercaseQuery) ||
      chapter.sourceUrl.toLowerCase().includes(lowercaseQuery) ||
      chapter.novelTitle?.toLowerCase().includes(lowercaseQuery) ||
      chapter.originalMarkdown.toLowerCase().includes(lowercaseQuery) ||
      chapter.translatedText.toLowerCase().includes(lowercaseQuery)
    );
  }, [chapters]);

  // Sort functionality
  const sortChapters = useCallback((sortBy: 'lastAccessed' | 'createdAt' | 'title' | 'chapterNumber'): ChapterRecord[] => {
    return [...chapters].sort((a, b) => {
      switch (sortBy) {
        case 'lastAccessed':
          return b.lastAccessed - a.lastAccessed;
        case 'createdAt':
          return b.createdAt - a.createdAt;
        case 'title':
          return a.title.localeCompare(b.title);
        case 'chapterNumber':
          return (a.chapterNumber || 0) - (b.chapterNumber || 0);
        default:
          return 0;
      }
    });
  }, [chapters]);

  // Export library as JSON
  const exportLibrary = useCallback(async (): Promise<{ data: string; filename: string }> => {
    try {
      const [allChapters, allHistory, stats] = await Promise.all([
        chapterStorage.getAllChapters(),
        chapterStorage.getReadingHistory(1000), // Export more history
        chapterStorage.getStorageStats()
      ]);

      const exportData = {
        version: '1.0',
        exportedAt: Date.now(),
        stats,
        chapters: allChapters,
        history: allHistory,
        metadata: {
          appName: 'Gemini Novel Reader',
          description: 'Complete chapter library backup'
        }
      };

      const data = JSON.stringify(exportData, null, 2);
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const filename = `gemini-novel-reader-backup-${timestamp}.json`;

      return { data, filename };
    } catch (error) {
      console.error('Failed to export library:', error);
      throw error;
    }
  }, []);

  // Import library from JSON
  const importLibrary = useCallback(async (jsonData: string): Promise<{ importedChapters: number; skippedChapters: number; errors: string[] }> => {
    try {
      const importData = JSON.parse(jsonData);
      const errors: string[] = [];
      let importedChapters = 0;
      let skippedChapters = 0;

      // Validate import data structure
      if (!importData.chapters || !Array.isArray(importData.chapters)) {
        throw new Error('Invalid import data: missing chapters array');
      }

      // Import chapters
      for (const chapterData of importData.chapters) {
        try {
          // Check if chapter already exists
          const existing = await chapterStorage.getChapterByUrl(chapterData.sourceUrl);
          
          if (existing) {
            skippedChapters++;
            continue;
          }

          // Create new chapter record (readingProgress will be auto-generated)
          await chapterStorage.createChapter({
            sourceUrl: chapterData.sourceUrl,
            chapterNumber: chapterData.chapterNumber,
            title: chapterData.title,
            originalMarkdown: chapterData.originalMarkdown,
            translatedText: chapterData.translatedText,
            nextUrl: chapterData.nextUrl,
            prevUrl: chapterData.prevUrl,
            novelTitle: chapterData.novelTitle,
            novelAuthor: chapterData.novelAuthor
          });

          importedChapters++;
        } catch (error) {
          errors.push(`Failed to import chapter "${chapterData.title}": ${error}`);
        }
      }

      return { importedChapters, skippedChapters, errors };
    } catch (error) {
      console.error('Failed to import library:', error);
      throw error;
    }
  }, []);

  // Cleanup old chapters
  const cleanupOldChapters = useCallback(async (): Promise<number> => {
    try {
      const deletedCount = await chapterStorage.cleanupOldChapters(cleanupDays);
      if (deletedCount > 0) {
        await refreshData();
      }
      return deletedCount;
    } catch (error) {
      console.error('Failed to cleanup old chapters:', error);
      return 0;
    }
  }, [cleanupDays, refreshData]);

  // Clear all data
  const clearAllData = useCallback(async (): Promise<void> => {
    try {
      // This would need to be implemented in the ChapterStorage class
      // For now, we'll just refresh the data
      await refreshData();
    } catch (error) {
      console.error('Failed to clear all data:', error);
      throw error;
    }
  }, [refreshData]);

  return {
    // Core data
    chapters,
    history,
    storageStats,
    
    // Loading states
    isLoading,
    isInitialized,
    
    // CRUD operations
    saveChapter,
    loadChapter,
    updateChapter,
    deleteChapter,
    
    // Reading progress
    updateProgress,
    
    // History and search
    searchChapters,
    sortChapters,
    
    // Utilities
    refreshData,
    clearAllData,
    
    // Storage management
    exportLibrary,
    importLibrary,
    cleanupOldChapters,
    
    // Real-time sync
    isSynced
  };
}

// Hook for reading progress tracking
export function useReadingProgress(chapterId: string | null, updateProgressFunc?: (chapterId: string, progress: any) => Promise<void>) {
  const [isReading, setIsReading] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const progressRef = useRef({
    scrollY: 0,
    scrollHeight: 0,
    lastProgress: 0
  });

  // Track scroll position
  useEffect(() => {
    if (!chapterId || !updateProgressFunc) return;

    const handleScroll = () => {
      if (!isReading) {
        setIsReading(true);
        setStartTime(Date.now());
      }

      const scrollY = window.scrollY;
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      const percentage = scrollHeight > 0 ? Math.min((scrollY / scrollHeight) * 100, 100) : 0;

      // Throttle progress updates to avoid too frequent database writes
      const now = Date.now();
      if (now - progressRef.current.lastProgress > 5000) { // Update every 5 seconds
        updateProgressFunc(chapterId, {
          scrollY,
          scrollHeight,
          percentage
        }).catch(console.error);
        
        progressRef.current.lastProgress = now;
      }

      progressRef.current = { scrollY, scrollHeight, lastProgress: progressRef.current.lastProgress };
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [chapterId, isReading, updateProgressFunc]);

  // Reset reading state when chapter changes
  useEffect(() => {
    if (!chapterId) {
      setIsReading(false);
      setStartTime(null);
    }
  }, [chapterId]);

  return {
    isReading,
    readingTime: startTime ? Date.now() - startTime : 0,
    progress: progressRef.current
  };
}
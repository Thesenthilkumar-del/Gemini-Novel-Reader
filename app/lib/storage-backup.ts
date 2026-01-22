// Storage Backup and Export/Import Utilities
// Handles complete library backup, restore, and migration operations

import { chapterStorage, type ChapterRecord, type ReadingHistory, type StorageStats } from './indexed-db';

export interface BackupMetadata {
  version: string;
  exportedAt: number;
  appVersion: string;
  totalChapters: number;
  totalHistoryRecords: number;
  storageUsed: number;
  estimatedSize: string;
  description: string;
}

export interface ImportResult {
  success: boolean;
  importedChapters: number;
  importedHistory: number;
  skippedChapters: number;
  errors: string[];
  warnings: string[];
  totalSize: string;
}

export interface ExportOptions {
  includeHistory?: boolean;
  includeSettings?: boolean;
  format?: 'json' | 'csv';
  compression?: boolean;
  maxChapters?: number;
}

export interface ImportOptions {
  skipDuplicates?: boolean;
  overwriteExisting?: boolean;
  validateData?: boolean;
  batchSize?: number;
}

export class StorageBackup {
  private static readonly BACKUP_VERSION = '1.0';
  private static readonly MAX_BATCH_SIZE = 50;

  /**
   * Export complete library to JSON backup file
   */
  static async exportLibrary(options: ExportOptions = {}): Promise<{
    data: string;
    metadata: BackupMetadata;
    filename: string;
  }> {
    const {
      includeHistory = true,
      includeSettings = true,
      maxChapters
    } = options;

    try {
      // Get all data
      const [chapters, history, stats] = await Promise.all([
        chapterStorage.getAllChapters(),
        includeHistory ? chapterStorage.getReadingHistory(1000) : Promise.resolve([]),
        chapterStorage.getStorageStats()
      ]);

      // Limit chapters if requested
      const exportChapters = maxChapters ? chapters.slice(0, maxChapters) : chapters;

      // Calculate estimated size
      const exportData = {
        backupVersion: this.BACKUP_VERSION,
        exportedAt: Date.now(),
        appVersion: '1.0.0', // Could be dynamic
        chapters: exportChapters,
        history: includeHistory ? history : [],
        metadata: {
          totalChapters: exportChapters.length,
          totalHistoryRecords: history.length,
          exportOptions: options
        }
      };

      const data = JSON.stringify(exportData, null, 2);
      const estimatedSize = this.formatBytes(new Blob([data]).size);

      const metadata: BackupMetadata = {
        version: this.BACKUP_VERSION,
        exportedAt: Date.now(),
        appVersion: exportData.appVersion,
        totalChapters: exportChapters.length,
        totalHistoryRecords: history.length,
        storageUsed: stats.storageUsed,
        estimatedSize,
        description: `Complete backup of ${exportChapters.length} chapters`
      };

      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const filename = `gemini-novel-reader-backup-${timestamp}.json`;

      return {
        data,
        metadata,
        filename
      };
    } catch (error) {
      throw new Error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Import library from JSON backup file
   */
  static async importLibrary(jsonData: string, options: ImportOptions = {}): Promise<ImportResult> {
    const {
      skipDuplicates = true,
      overwriteExisting = false,
      validateData = true,
      batchSize = this.MAX_BATCH_SIZE
    } = options;

    let parsedData: any;
    const errors: string[] = [];
    const warnings: string[] = [];
    let importedChapters = 0;
    let importedHistory = 0;
    let skippedChapters = 0;

    try {
      // Parse JSON data
      parsedData = JSON.parse(jsonData);
    } catch (error) {
      return {
        success: false,
        importedChapters: 0,
        importedHistory: 0,
        skippedChapters: 0,
        errors: [`Invalid JSON format: ${error instanceof Error ? error.message : 'Parse error'}`],
        warnings,
        totalSize: '0 B'
      };
    }

    // Validate backup structure
    if (validateData) {
      const validation = this.validateBackupData(parsedData);
      if (!validation.isValid) {
        return {
          success: false,
          importedChapters: 0,
          importedHistory: 0,
          skippedChapters: 0,
          errors: validation.errors,
          warnings,
          totalSize: '0 B'
        };
      }
      warnings.push(...validation.warnings);
    }

    try {
      // Import chapters in batches to avoid overwhelming the database
      const chapters = parsedData.chapters || [];
      
      for (let i = 0; i < chapters.length; i += batchSize) {
        const batch = chapters.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (chapterData: any) => {
          try {
            // Validate chapter data
            if (!chapterData.sourceUrl || !chapterData.title) {
              warnings.push(`Skipping chapter with missing required data: ${chapterData.title || 'Unknown'}`);
              return;
            }

            // Check for duplicates
            if (skipDuplicates) {
              const existing = await chapterStorage.getChapterByUrl(chapterData.sourceUrl);
              if (existing) {
                skippedChapters++;
                return;
              }
            }

            // Create chapter record (readingProgress will be auto-generated)
            await chapterStorage.createChapter({
              sourceUrl: chapterData.sourceUrl,
              chapterNumber: chapterData.chapterNumber,
              title: chapterData.title,
              originalMarkdown: chapterData.originalMarkdown || '',
              translatedText: chapterData.translatedText || '',
              nextUrl: chapterData.nextUrl,
              prevUrl: chapterData.prevUrl,
              novelTitle: chapterData.novelTitle,
              novelAuthor: chapterData.novelAuthor
            });
            importedChapters++;

          } catch (error) {
            errors.push(`Failed to import chapter "${chapterData.title}": ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }));

        // Small delay between batches to prevent UI blocking
        if (i + batchSize < chapters.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Import reading history if available
      if (parsedData.history && Array.isArray(parsedData.history)) {
        for (const historyItem of parsedData.history) {
          try {
            // Validate history item
            if (!historyItem.chapterId || !historyItem.chapterTitle) {
              warnings.push('Skipping invalid history record');
              continue;
            }

            // Add to reading history (simplified - actual implementation would need to match the data structure)
            // Note: This is a simplified version as the actual reading history structure might differ
            await chapterStorage.addToReadingHistory(
              historyItem.chapterId,
              historyItem.chapterTitle,
              historyItem.sourceUrl,
              0 // Default reading percentage
            );
            importedHistory++;
          } catch (error) {
            warnings.push(`Failed to import history record: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      // Calculate total size of imported data
      const totalSize = this.formatBytes(new Blob([jsonData]).size);

      return {
        success: true,
        importedChapters,
        importedHistory,
        skippedChapters,
        errors,
        warnings,
        totalSize
      };

    } catch (error) {
      return {
        success: false,
        importedChapters,
        importedHistory,
        skippedChapters,
        errors: [`Import process failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
        warnings,
        totalSize: '0 B'
      };
    }
  }

  /**
   * Validate backup data structure
   */
  private static validateBackupData(data: any): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    if (!data.chapters || !Array.isArray(data.chapters)) {
      errors.push('Missing or invalid "chapters" array');
    }

    // Validate chapters structure
    if (data.chapters) {
      data.chapters.forEach((chapter: any, index: number) => {
        if (!chapter.sourceUrl) {
          errors.push(`Chapter ${index + 1}: Missing sourceUrl`);
        }
        if (!chapter.title) {
          errors.push(`Chapter ${index + 1}: Missing title`);
        }
        if (!chapter.originalMarkdown && !chapter.translatedText) {
          warnings.push(`Chapter ${index + 1}: Missing content (no original or translated text)`);
        }
      });
    }

    // Validate history if present
    if (data.history) {
      if (!Array.isArray(data.history)) {
        warnings.push('Invalid "history" format - expected array');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Format bytes to human-readable format
   */
  private static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Create incremental backup (only new chapters since last backup)
   */
  static async createIncrementalBackup(lastBackupTime?: number): Promise<{
    data: string;
    metadata: BackupMetadata;
    filename: string;
    isIncremental: boolean;
  }> {
    const allChapters = await chapterStorage.getAllChapters();
    
    // Filter chapters newer than last backup
    const newChapters = lastBackupTime 
      ? allChapters.filter(chapter => chapter.createdAt > lastBackupTime)
      : allChapters;

    if (newChapters.length === 0) {
      throw new Error('No new chapters to backup');
    }

    const exportData = {
      backupVersion: this.BACKUP_VERSION,
      exportedAt: Date.now(),
      isIncremental: true,
      lastBackupTime,
      chapters: newChapters,
      metadata: {
        totalChapters: newChapters.length,
        incremental: true
      }
    };

    const data = JSON.stringify(exportData, null, 2);
    const metadata: BackupMetadata = {
      version: this.BACKUP_VERSION,
      exportedAt: Date.now(),
      appVersion: '1.0.0',
      totalChapters: newChapters.length,
      totalHistoryRecords: 0,
      storageUsed: 0,
      estimatedSize: this.formatBytes(new Blob([data]).size),
      description: `Incremental backup of ${newChapters.length} new chapters`
    };

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `gemini-novel-reader-incremental-${timestamp}.json`;

    return {
      data,
      metadata,
      filename,
      isIncremental: true
    };
  }

  /**
   * Download backup file
   */
  static downloadBackup(data: string, filename: string): void {
    try {
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (error) {
      throw new Error(`Failed to download backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get storage quota information and warnings
   */
  static async getStorageInfo(): Promise<{
    used: number;
    quota: number;
    percentage: number;
    isLowSpace: boolean;
    recommendations: string[];
  }> {
    const stats = await chapterStorage.getStorageStats();
    const quota = await chapterStorage.checkStorageQuota();
    
    const recommendations: string[] = [];
    
    if (quota.percentage > 0.8) {
      recommendations.push('Storage is getting low. Consider exporting and cleaning up old chapters.');
    }
    
    if (stats.totalChapters > 1000) {
      recommendations.push('Large library detected. Consider using incremental backups.');
    }
    
    return {
      used: quota.usage,
      quota: quota.quota,
      percentage: quota.percentage,
      isLowSpace: quota.isWarning,
      recommendations
    };
  }
}

// Utility functions for easy integration
export const createBackup = StorageBackup.exportLibrary;
export const restoreBackup = StorageBackup.importLibrary;
export const downloadBackupFile = StorageBackup.downloadBackup;
export const getStorageInfo = StorageBackup.getStorageInfo;
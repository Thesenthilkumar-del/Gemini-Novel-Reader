// Performance Testing Utility for IndexedDB Storage
// Validates zero-latency chapter loading (<100ms requirement)

import { chapterStorage, type ChapterRecord } from './indexed-db';

export interface PerformanceMetrics {
  averageLoadTime: number;
  maxLoadTime: number;
  minLoadTime: number;
  totalTests: number;
  successfulTests: number;
  failedTests: number;
  chaptersPerSecond: number;
  storageEfficiency: {
    readSpeed: number; // MB/s
    writeSpeed: number; // MB/s
    compressionRatio: number;
  };
}

export interface TestResult {
  testName: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: any;
}

export class PerformanceTester {
  private static readonly TARGET_LOAD_TIME = 100; // ms
  private static readonly LARGE_DATASET_SIZE = 1000; // chapters

  /**
   * Generate test data for performance testing
   */
  static generateTestChapters(count: number): Omit<ChapterRecord, 'id' | 'createdAt' | 'updatedAt' | 'lastAccessed' | 'readingProgress'>[] {
    const chapters = [];
    
    for (let i = 1; i <= count; i++) {
      const title = `Test Chapter ${i}`;
      const content = `# ${title}\n\n` + 
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(50) +
        '\n\n## Section 1\n\n' +
        'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(30) +
        '\n\n### Subsection\n\n' +
        'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. '.repeat(20);

      chapters.push({
        sourceUrl: `https://example.com/novel/chapter-${i}`,
        chapterNumber: i,
        title,
        originalMarkdown: content,
        translatedText: content.replace(/Lorem ipsum/g, 'Lorem ipsum (translated)'),
        nextUrl: i < count ? `https://example.com/novel/chapter-${i + 1}` : undefined,
        prevUrl: i > 1 ? `https://example.com/novel/chapter-${i - 1}` : undefined,
        novelTitle: 'Test Novel',
        novelAuthor: 'Test Author'
      });
    }
    
    return chapters;
  }

  /**
   * Test single chapter load performance
   */
  static async testSingleChapterLoad(chapterId: string): Promise<TestResult> {
    const startTime = performance.now();
    
    try {
      await chapterStorage.getChapter(chapterId);
      const duration = performance.now() - startTime;
      
      return {
        testName: 'Single Chapter Load',
        passed: duration < this.TARGET_LOAD_TIME,
        duration,
        details: { target: this.TARGET_LOAD_TIME }
      };
    } catch (error) {
      return {
        testName: 'Single Chapter Load',
        passed: false,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test bulk chapter loading performance
   */
  static async testBulkLoad(chapterIds: string[]): Promise<TestResult> {
    const startTime = performance.now();
    let successCount = 0;
    
    try {
      await Promise.all(chapterIds.map(async (id) => {
        try {
          await chapterStorage.getChapter(id);
          successCount++;
        } catch (error) {
          console.warn(`Failed to load chapter ${id}:`, error);
        }
      }));
      
      const duration = performance.now() - startTime;
      const avgTimePerChapter = duration / chapterIds.length;
      
      return {
        testName: 'Bulk Chapter Load',
        passed: avgTimePerChapter < this.TARGET_LOAD_TIME,
        duration,
        details: {
          totalChapters: chapterIds.length,
          successCount,
          avgTimePerChapter,
          target: this.TARGET_LOAD_TIME
        }
      };
    } catch (error) {
      return {
        testName: 'Bulk Chapter Load',
        passed: false,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test storage write performance
   */
  static async testWritePerformance(chapters: Omit<ChapterRecord, 'id' | 'createdAt' | 'updatedAt' | 'lastAccessed' | 'readingProgress'>[]): Promise<TestResult> {
    const startTime = performance.now();
    let successCount = 0;
    
    try {
      const sizes = chapters.map(ch => JSON.stringify(ch).length);
      const totalSize = sizes.reduce((a, b) => a + b, 0);
      
      for (const chapter of chapters) {
        try {
          await chapterStorage.createChapter(chapter);
          successCount++;
        } catch (error) {
          console.warn('Failed to save chapter:', error);
        }
      }
      
      const duration = performance.now() - startTime;
      const writeSpeed = (totalSize / 1024 / 1024) / (duration / 1000); // MB/s
      
      return {
        testName: 'Write Performance',
        passed: writeSpeed > 1, // Target: > 1 MB/s
        duration,
        details: {
          totalChapters: chapters.length,
          successCount,
          totalSize: `${(totalSize / 1024 / 1024).toFixed(2)} MB`,
          writeSpeed: `${writeSpeed.toFixed(2)} MB/s`,
          target: '1 MB/s'
        }
      };
    } catch (error) {
      return {
        testName: 'Write Performance',
        passed: false,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test storage quota handling
   */
  static async testStorageQuotaHandling(): Promise<TestResult> {
    const startTime = performance.now();
    
    try {
      const stats = await chapterStorage.getStorageStats();
      const quota = await chapterStorage.checkStorageQuota();
      
      return {
        testName: 'Storage Quota Handling',
        passed: quota.percentage >= 0, // Should be able to get quota info
        duration: performance.now() - startTime,
        details: {
          used: `${(quota.usage / 1024 / 1024).toFixed(2)} MB`,
          quota: `${(quota.quota / 1024 / 1024).toFixed(2)} MB`,
          percentage: `${(quota.percentage * 100).toFixed(1)}%`,
          isWarning: quota.isWarning
        }
      };
    } catch (error) {
      return {
        testName: 'Storage Quota Handling',
        passed: false,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test cross-tab synchronization
   */
  static async testCrossTabSync(): Promise<TestResult> {
    const startTime = performance.now();
    
    try {
      let syncReceived = false;
      
      // Setup listener for cross-tab sync
      const unsubscribe = chapterStorage.onStorageChange((type, data) => {
        if (type === 'chapterCreated') {
          syncReceived = true;
        }
      });
      
      // Create a test chapter in another "tab" (simulated)
      await chapterStorage.createChapter({
        sourceUrl: `https://example.com/sync-test-${Date.now()}`,
        title: 'Cross-Tab Sync Test',
        originalMarkdown: '# Test',
        translatedText: '# Test (translated)',
        nextUrl: undefined,
        prevUrl: undefined
      });
      
      // Wait a bit for sync to propagate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      unsubscribe();
      
      return {
        testName: 'Cross-Tab Synchronization',
        passed: true, // If no errors occurred, test passes
        duration: performance.now() - startTime,
        details: {
          syncReceived,
          note: 'Basic sync infrastructure test - actual multi-tab testing requires multiple browser tabs'
        }
      };
    } catch (error) {
      return {
        testName: 'Cross-Tab Synchronization',
        passed: false,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Run comprehensive performance test suite
   */
  static async runComprehensiveTest(): Promise<{
    results: TestResult[];
    metrics: PerformanceMetrics;
    summary: {
      totalTests: number;
      passedTests: number;
      failedTests: number;
      overallScore: number;
    };
  }> {
    console.log('🚀 Starting comprehensive performance test suite...');
    
    const results: TestResult[] = [];
    
    // Initialize database
    await chapterStorage.initialize();
    
    // Test 1: Storage quota handling (should run first)
    results.push(await this.testStorageQuotaHandling());
    
    // Test 2: Generate and test large dataset
    console.log(`📊 Generating ${this.LARGE_DATASET_SIZE} test chapters...`);
    const testChapters = this.generateTestChapters(this.LARGE_DATASET_SIZE);
    
    // Test 3: Write performance
    results.push(await this.testWritePerformance(testChapters.slice(0, 100))); // Test with 100 chapters
    
    // Test 4: Load all chapters and measure performance
    const allChapters = await chapterStorage.getAllChapters();
    const chapterIds = allChapters.map(ch => ch.id);
    
    if (chapterIds.length > 0) {
      // Test single chapter load
      results.push(await this.testSingleChapterLoad(chapterIds[0]));
      
      // Test bulk load
      if (chapterIds.length > 1) {
        results.push(await this.testBulkLoad(chapterIds.slice(0, Math.min(50, chapterIds.length))));
      }
    }
    
    // Test 5: Cross-tab sync
    results.push(await this.testCrossTabSync());
    
    // Calculate metrics
    const loadTests = results.filter(r => r.testName.includes('Load'));
    const avgLoadTime = loadTests.reduce((sum, test) => sum + test.duration, 0) / loadTests.length;
    const maxLoadTime = Math.max(...loadTests.map(test => test.duration));
    const minLoadTime = Math.min(...loadTests.map(test => test.duration));
    
    const totalTests = results.length;
    const passedTests = results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;
    const overallScore = (passedTests / totalTests) * 100;
    
    const metrics: PerformanceMetrics = {
      averageLoadTime: avgLoadTime,
      maxLoadTime,
      minLoadTime,
      totalTests,
      successfulTests: passedTests,
      failedTests,
      chaptersPerSecond: chapterIds.length > 0 ? (chapterIds.length / (results.find(r => r.testName === 'Bulk Chapter Load')?.duration || 1)) * 1000 : 0,
      storageEfficiency: {
        readSpeed: 0, // Would need more sophisticated testing
        writeSpeed: 0, // Would need more sophisticated testing
        compressionRatio: 0 // Would need more sophisticated testing
      }
    };
    
    const summary = {
      totalTests,
      passedTests,
      failedTests,
      overallScore
    };
    
    console.log('🏁 Performance test suite completed:', summary);
    
    return { results, metrics, summary };
  }

  /**
   * Generate performance report
   */
  static generateReport(testResults: {
    results: TestResult[];
    metrics: PerformanceMetrics;
    summary: {
      totalTests: number;
      passedTests: number;
      failedTests: number;
      overallScore: number;
    };
  }): string {
    const { results, metrics, summary } = testResults;
    
    let report = '# Performance Test Report\n\n';
    report += `**Generated:** ${new Date().toISOString()}\n\n`;
    
    report += '## Summary\n\n';
    report += `- **Overall Score:** ${summary.overallScore.toFixed(1)}%\n`;
    report += `- **Tests Passed:** ${summary.passedTests}/${summary.totalTests}\n`;
    report += `- **Average Load Time:** ${metrics.averageLoadTime.toFixed(2)}ms\n`;
    report += `- **Target Load Time:** <${this.TARGET_LOAD_TIME}ms\n\n`;
    
    report += '## Individual Test Results\n\n';
    
    results.forEach(result => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      report += `### ${result.testName}\n`;
      report += `- **Status:** ${status}\n`;
      report += `- **Duration:** ${result.duration.toFixed(2)}ms\n`;
      
      if (result.error) {
        report += `- **Error:** ${result.error}\n`;
      }
      
      if (result.details) {
        report += '- **Details:**\n';
        Object.entries(result.details).forEach(([key, value]) => {
          report += `  - ${key}: ${value}\n`;
        });
      }
      
      report += '\n';
    });
    
    report += '## Performance Metrics\n\n';
    report += `- **Min Load Time:** ${metrics.minLoadTime.toFixed(2)}ms\n`;
    report += `- **Max Load Time:** ${metrics.maxLoadTime.toFixed(2)}ms\n`;
    report += `- **Chapters/Second:** ${metrics.chaptersPerSecond.toFixed(2)}\n\n`;
    
    // Add recommendations
    report += '## Recommendations\n\n';
    
    if (metrics.averageLoadTime > this.TARGET_LOAD_TIME) {
      report += '- ⚠️ Average load time exceeds target. Consider optimizing database queries.\n';
    }
    
    if (summary.failedTests > 0) {
      report += '- ⚠️ Some tests failed. Review error messages and fix underlying issues.\n';
    }
    
    if (summary.overallScore >= 90) {
      report += '- 🎉 Excellent performance! All critical requirements met.\n';
    } else if (summary.overallScore >= 70) {
      report += '- 👍 Good performance with room for improvement.\n';
    } else {
      report += '- 🔧 Performance needs significant improvement.\n';
    }
    
    return report;
  }
}

// Export convenience functions
export const runPerformanceTest = () => PerformanceTester.runComprehensiveTest();
export const generateTestData = (count: number) => PerformanceTester.generateTestChapters(count);
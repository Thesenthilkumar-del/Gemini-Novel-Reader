'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, BookOpen, Menu, History, ChevronLeft, ChevronRight, Check, Trash2, Download, Upload, Settings, AlertTriangle, Database } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useChapterStorage, useReadingProgress } from './hooks/useChapterStorage';
import { createBackup, restoreBackup, downloadBackupFile, getStorageInfo } from './lib/storage-backup';
import type { ChapterRecord } from './lib/indexed-db';

export default function Home() {
  const [url, setUrl] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [translatedContent, setTranslatedContent] = useState('');
  const [chapterTitle, setChapterTitle] = useState('');
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [prevUrl, setPrevUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentChapter, setCurrentChapter] = useState<ChapterRecord | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [jumpToInput, setJumpToInput] = useState('');

  // Use the new zero-latency IndexedDB storage
  const {
    chapters,
    history,
    storageStats,
    isLoading,
    isInitialized,
    saveChapter,
    loadChapter,
    updateChapter,
    deleteChapter,
    updateProgress,
    searchChapters,
    sortChapters,
    exportLibrary,
    importLibrary,
    cleanupOldChapters,
    isSynced
  } = useChapterStorage({
    autoCleanup: true,
    cleanupDays: 30,
    trackProgress: true
  });

  // Track reading progress
  const { isReading, readingTime, progress } = useReadingProgress(currentChapter?.id || null, updateProgress);

  // Monitor storage quota
  useEffect(() => {
    const checkStorageQuota = async () => {
      try {
        const storageInfo = await getStorageInfo();
        setStorageWarning(storageInfo.isLowSpace);
      } catch (error) {
        console.error('Failed to check storage quota:', error);
      }
    };

    checkStorageQuota();
    const interval = setInterval(checkStorageQuota, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Check if current URL has a saved chapter
  const checkIfSaved = useCallback(async () => {
    if (!url || !isInitialized) {
      setIsSaved(false);
      return;
    }

    try {
      const chapter = await loadChapter(url);
      setIsSaved(!!chapter);
      if (chapter) {
        setCurrentChapter(chapter);
      }
    } catch (e) {
      setIsSaved(false);
    }
  }, [url, isInitialized, loadChapter]);

  // Check saved status when content changes
  useEffect(() => {
    if (url && translatedContent && isInitialized) {
      checkIfSaved();
    }
  }, [url, translatedContent, isInitialized, checkIfSaved]);


  // 🧠 SMART URL PREDICTOR (unchanged)
  const predictNextUrl = (currentUrl: string) => {
    // 1. Try to find number at end of URL
    const match = currentUrl.match(/(\d+)(\/?)$/);
    if (match) {
      const num = parseInt(match[1]);
      return currentUrl.replace(match[1], (num + 1).toString());
    }
    // 2. Try to find "chapter-123" pattern
    const match2 = currentUrl.match(/(chapter-?)(\d+)/i);
    if (match2) {
      const num = parseInt(match2[2]);
      return currentUrl.replace(match2[0], `${match2[1]}${num + 1}`);
    }
    return null;
  };

  const predictPrevUrl = (currentUrl: string) => {
    const match = currentUrl.match(/(\d+)(\/?)$/);
    if (match) {
      const num = parseInt(match[1]);
      if (num > 1) return currentUrl.replace(match[1], (num - 1).toString());
    }
    return null;
  };

  // Load chapter from storage (zero-latency)
  const loadChapterFromStorage = async (chapter: ChapterRecord) => {
    setUrl(chapter.sourceUrl);
    setOriginalContent(chapter.originalMarkdown);
    setTranslatedContent(chapter.translatedText);
    setChapterTitle(chapter.title);
    setNextUrl(chapter.nextUrl || null);
    setPrevUrl(chapter.prevUrl || null);
    setCurrentChapter(chapter);
    setHistoryOpen(false);
    setError('');
    setIsSaved(true);

    // Update last accessed time
    await updateChapter(chapter.id, { lastAccessed: Date.now() });
  };

  const handleTranslate = async (overrideUrl?: string) => {
    const targetUrl = overrideUrl || url;
    if (!targetUrl.trim()) return;

    // Update state to match what we are fetching
    if (overrideUrl) setUrl(overrideUrl);

    // Check IndexedDB first (zero-latency load)
    try {
      const existing = await loadChapter(targetUrl);
      if (existing) {
        loadChapterFromStorage(existing);
        return;
      }
    } catch (e) {
      console.error('Failed to check IndexedDB:', e);
    }

    setLoading(true);
    setError('');
    setOriginalContent('');
    setTranslatedContent('');
    setIsSaved(false);
    setCurrentChapter(null);

    try {
      // 1. Scrape
      const jinaRes = await fetch(`https://r.jina.ai/${targetUrl}`, {
        headers: { 'Accept': 'text/markdown' }
      });
      if (!jinaRes.ok) throw new Error('Failed to fetch novel content');

      const markdown = await jinaRes.text();
      setOriginalContent(markdown);
      
      const titleMatch = markdown.match(/^#+\s*(.+)$/m);
      setChapterTitle(titleMatch ? titleMatch[1] : '');

      // 2. Translate
      const translateRes = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: markdown }),
      });

      if (!translateRes.ok) throw new Error('Translation failed');

      const { translatedText } = await translateRes.json();
      setTranslatedContent(translatedText || '');

      // 3. Navigation (Regex + Heuristic Backup)
      let finalNext: string | null = markdown.match(/\[(?:Next|Continue|下一章)[^\]]*\]\(([^)]+)\)/i)?.[1] || null;
      if (!finalNext) finalNext = predictNextUrl(targetUrl);
      setNextUrl(finalNext);

      let finalPrev: string | null = markdown.match(/\[(?:Previous|Prev|上一章)[^\]]*\]\(([^)]+)\)/i)?.[1] || null;
      if (!finalPrev) finalPrev = predictPrevUrl(targetUrl);
      setPrevUrl(finalPrev);

      // 4. Save to IndexedDB (automatic sync)
      if (translatedText) {
        try {
          const chapterId = await saveChapter({
            sourceUrl: targetUrl,
            title: chapterTitle || 'Untitled Chapter',
            originalMarkdown: markdown,
            translatedText,
            nextUrl: finalNext || undefined,
            prevUrl: finalPrev || undefined,
            novelTitle: undefined, // Could be extracted from content
            novelAuthor: undefined
          });
          
          setIsSaved(true);
          console.log(`Chapter saved to IndexedDB with ID: ${chapterId}`);
        } catch (saveError) {
          console.error('Failed to save to IndexedDB:', saveError);
          // Don't fail the whole operation if save fails
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Navigation Handlers
  const handleNext = () => {
    if (nextUrl) handleTranslate(nextUrl);
  };

  const handlePrev = () => {
    if (prevUrl) handleTranslate(prevUrl);
  };

  // Delete chapter with IndexedDB
  const handleDeleteChapter = async (e: React.MouseEvent, chapterId: string) => {
    e.stopPropagation();
    if (confirm('Delete this chapter?')) {
      try {
        await deleteChapter(chapterId);
        // Clear current view if this was the active chapter
        if (currentChapter?.id === chapterId) {
          setUrl('');
          setOriginalContent('');
          setTranslatedContent('');
          setChapterTitle('');
          setCurrentChapter(null);
          setIsSaved(false);
        }
      } catch (error) {
        console.error('Failed to delete chapter:', error);
        alert('Failed to delete chapter. Please try again.');
      }
    }
  };

  // Backup and Import Handlers
  const handleExportLibrary = async () => {
    try {
      setLoading(true);
      const result = await exportLibrary();
      downloadBackupFile(result.data, result.filename);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleImportLibrary = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      const fileContent = await file.text();
      const result = await importLibrary(fileContent);
      
      // Show import results
      const message = `Import completed!\n` +
        `Imported: ${result.importedChapters} chapters\n` +
        `Skipped: ${result.skippedChapters} chapters\n` +
        `Errors: ${result.errors.length}`;
      
      if (result.errors.length > 0) {
        console.warn('Import errors:', result.errors);
      }
      
      alert(message);
    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed. Please check the file format and try again.');
    } finally {
      setLoading(false);
      // Reset the input
      event.target.value = '';
    }
  };

  // Cleanup old chapters
  const handleCleanupOldChapters = async () => {
    if (confirm('Delete chapters older than 30 days? This action cannot be undone.')) {
      try {
        setLoading(true);
        const deletedCount = await cleanupOldChapters();
        alert(`Cleaned up ${deletedCount} old chapters.`);
      } catch (error) {
        console.error('Cleanup failed:', error);
        alert('Cleanup failed. Please try again.');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className='min-h-screen bg-[#fdfbf7]'>
      {/* Storage Warning */}
      {storageWarning && (
        <div className='bg-yellow-100 border-b border-yellow-300 px-4 py-2 flex items-center gap-2'>
          <AlertTriangle className='w-5 h-5 text-yellow-600' />
          <span className='text-yellow-800'>Storage space is running low. Consider exporting and cleaning up old chapters.</span>
        </div>
      )}

      {/* Cross-tab Sync Indicator */}
      {isSynced && (
        <div className='bg-green-100 border-b border-green-300 px-4 py-1 flex items-center gap-2'>
          <Database className='w-4 h-4 text-green-600' />
          <span className='text-green-800 text-sm'>Synced with other tabs</span>
        </div>
      )}

      {/* Mobile Header */}
      <div className='lg:hidden bg-white border-b border-amber-200 sticky top-0 z-50'>
        <div className='flex items-center justify-between p-4'>
          <div className='flex items-center gap-2'>
            <BookOpen className='w-6 h-6 text-amber-800' />
            <h1 className='text-xl font-bold text-amber-900'>Gemini Novel Reader</h1>
          </div>
          <div className='flex items-center gap-2'>
            {isLoading && <Loader2 className='w-5 h-5 animate-spin' />}
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className='p-2 hover:bg-amber-50 rounded-lg transition-colors'
              aria-label='Settings'
            >
              <Settings className='w-6 h-6' />
            </button>
            <button
              onClick={() => setHistoryOpen(!historyOpen)}
              className='p-2 hover:bg-amber-50 rounded-lg transition-colors'
              aria-label='Toggle history'
            >
              <Menu className='w-6 h-6' />
            </button>
          </div>
        </div>
      </div>

      <div className='flex'>
        {/* Sidebar */}
        <div className={`${historyOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} fixed lg:sticky top-0 h-screen w-80 bg-white border-r border-amber-200 z-40 transition-transform overflow-y-auto`}>
          <div className='p-4'>
            {/* Desktop Header */}
            <div className='hidden lg:flex items-center gap-2 mb-4 font-bold text-amber-900'>
              <History className='w-5 h-5' />
              <span>History</span>
              <span className='text-sm text-gray-500'>({chapters.length})</span>
            </div>

            {/* Storage Stats */}
            {storageStats && (
              <div className='bg-amber-50 p-3 rounded-lg mb-4 text-sm'>
                <div className='flex justify-between items-center mb-2'>
                  <span className='font-semibold text-amber-900'>Storage</span>
                  <span className='text-amber-700'>{storageStats.totalChapters} chapters</span>
                </div>
                <div className='text-amber-700'>
                  {storageStats.storageUsed > 0 && (
                    <div>Used: {Math.round(storageStats.storageUsed / 1024 / 1024)}MB</div>
                  )}
                </div>
              </div>
            )}

            {/* Settings Panel */}
            {settingsOpen && (
              <div className='bg-gray-50 p-3 rounded-lg mb-4'>
                <h3 className='font-semibold text-gray-900 mb-3'>Settings</h3>
                <div className='space-y-2 text-sm'>
                  <button
                    onClick={handleExportLibrary}
                    disabled={loading}
                    className='w-full flex items-center gap-2 p-2 text-left hover:bg-gray-100 rounded'
                  >
                    <Download className='w-4 h-4' />
                    Export Library
                  </button>
                  <label className='w-full flex items-center gap-2 p-2 text-left hover:bg-gray-100 rounded cursor-pointer'>
                    <Upload className='w-4 h-4' />
                    Import Library
                    <input
                      type='file'
                      accept='.json'
                      onChange={handleImportLibrary}
                      className='hidden'
                      disabled={loading}
                    />
                  </label>
                  <button
                    onClick={handleCleanupOldChapters}
                    disabled={loading}
                    className='w-full flex items-center gap-2 p-2 text-left hover:bg-gray-100 rounded text-red-600'
                  >
                    <Trash2 className='w-4 h-4' />
                    Cleanup Old Chapters
                  </button>
                </div>
              </div>
            )}

            {/* History List */}
            {isLoading && chapters.length === 0 ? (
              <div className='flex items-center justify-center py-8'>
                <Loader2 className='w-6 h-6 animate-spin text-amber-600' />
              </div>
            ) : chapters.length === 0 ? (
              <p className='text-gray-500 text-sm'>No saved chapters yet</p>
            ) : (
              <div className='space-y-2'>
                {chapters.map(c => (
                  <div key={c.id} className='group relative'>
                    <button
                      onClick={() => loadChapterFromStorage(c)}
                      className='w-full text-left p-3 hover:bg-amber-50 rounded border border-transparent hover:border-amber-200 transition-colors'
                    >
                      <div className='font-medium text-sm text-gray-900 truncate'>
                        {c.title}
                      </div>
                      <div className='text-xs text-gray-500 mt-1'>
                        {new Date(c.lastAccessed).toLocaleDateString()}
                        {c.readingProgress.percentage > 0 && (
                          <span className='ml-2 text-amber-600'>
                            {Math.round(c.readingProgress.percentage)}% read
                          </span>
                        )}
                      </div>
                    </button>
                    <button
                      onClick={(e) => handleDeleteChapter(e, c.id)}
                      className='absolute right-2 top-2 p-1 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity'
                    >
                      <Trash2 className='w-4 h-4' />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className='flex-1 container mx-auto px-4 py-8 max-w-5xl'>
          {/* Desktop Header */}
          <div className='hidden lg:block text-center mb-8'>
            <div className='flex items-center justify-center gap-2 mb-4'>
              <BookOpen className='w-8 h-8 text-amber-800' />
              <h1 className='text-4xl font-bold text-amber-900'>Gemini Novel Reader</h1>
            </div>
            <p className='text-amber-700'>Translate and read novels with AI</p>
          </div>

          {/* Input Bar */}
          <div className='flex gap-2 mb-8'>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder='Paste Novel URL...'
              className='flex-1 border-2 border-amber-200 p-3 rounded-lg focus:outline-none focus:border-amber-400'
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && handleTranslate()}
            />
            <button
              onClick={() => handleTranslate()}
              disabled={loading}
              className='bg-amber-600 text-white px-6 rounded-lg font-bold disabled:opacity-50 flex items-center gap-2'
            >
              {loading ? <Loader2 className='animate-spin w-5 h-5' /> : 'Translate'}
            </button>
          </div>

          {error && <div className='bg-red-100 text-red-700 p-4 rounded mb-4'>{error}</div>}
          {isSaved && (
            <div className='text-green-600 flex gap-2 mb-4 items-center'>
              <Check className='w-5 h-5' />
              <span>Saved</span>
            </div>
          )}

          {/* Content Split */}
          {(originalContent || translatedContent) && (
            <div className='grid lg:grid-cols-2 gap-8'>
              <div className='hidden lg:block bg-white p-6 rounded shadow border border-amber-100'>
                <h2 className='font-bold text-xl mb-4 text-amber-900 border-b pb-2'>Original</h2>
                <div className='prose prose-lg max-w-none font-serif text-gray-800 leading-relaxed'>
                  <ReactMarkdown>{originalContent}</ReactMarkdown>
                </div>
              </div>
              <div className='bg-white p-6 rounded shadow border border-amber-100'>
                <h2 className='font-bold text-xl mb-4 text-amber-900 border-b pb-2'>Translated</h2>
                <div className='prose prose-lg max-w-none font-serif text-gray-800 leading-relaxed'>
                  <ReactMarkdown>{translatedContent}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {/* Floating Nav */}
          {(nextUrl || prevUrl) && (
            <div className='fixed bottom-6 left-1/2 -translate-x-1/2 flex gap-4 bg-white/90 backdrop-blur-sm p-2 rounded shadow border border-amber-200 z-50'>
              <button
                disabled={!prevUrl}
                onClick={handlePrev}
                className='flex gap-2 px-4 py-2 bg-amber-600 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed'
              >
                <ChevronLeft className='w-5 h-5' />
                Prev
              </button>
              <button
                disabled={!nextUrl}
                onClick={handleNext}
                className='flex gap-2 px-4 py-2 bg-amber-600 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed'
              >
                Next
                <ChevronRight className='w-5 h-5' />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile overlay to close history */}
      {historyOpen && (
        <div
          className='lg:hidden fixed inset-0 bg-black/50 z-30'
          onClick={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

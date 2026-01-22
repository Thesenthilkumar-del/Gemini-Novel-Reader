'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, BookOpen, Menu, History, ChevronLeft, ChevronRight, Check, Trash2, WifiOff, Edit3, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { saveChapter, getChapter, deleteChapter, getAllChapters, type ChapterData } from './lib/storage';
import { ErrorToast, useToast } from './components/ErrorToast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { handleError, ErrorHandler } from './lib/error-handler';
import { retryWithBackoff } from './lib/retry';
import { validateTranslationQuality, getQualityDescription } from './lib/quality-validation';

function HomeContent() {
  const [url, setUrl] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [translatedContent, setTranslatedContent] = useState('');
  const [chapterTitle, setChapterTitle] = useState('');
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [prevUrl, setPrevUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedChapters, setSavedChapters] = useState<ChapterData[]>([]);
  const [isSaved, setIsSaved] = useState(false);
  const [jumpToInput, setJumpToInput] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualContent, setManualContent] = useState('');
  const [translationQuality, setTranslationQuality] = useState<{ score: number; description: string } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTranslation, setEditedTranslation] = useState('');
  
  const toast = useToast();

  // Online/Offline detection
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.showSuccess('Back Online', 'Your internet connection has been restored.');
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      toast.showWarning('You are offline', 'Some features may be limited. Cached content is still available.');
    };

    setIsOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [toast]);

  const checkIfSaved = useCallback(async () => {
    try {
      const chapter = await getChapter(url);
      setIsSaved(!!chapter);
    } catch (e) {
      setIsSaved(false);
    }
  }, [url]);

  // Load history on mount
  useEffect(() => {
    loadChapters();
  }, []);

  // Check saved status when content changes
  useEffect(() => {
    if (url && translatedContent) checkIfSaved();
  }, [url, translatedContent, checkIfSaved]);

  const loadChapters = async () => {
    try {
      const chapters = await getAllChapters();
      setSavedChapters(chapters);
    } catch (e) {
      console.error(e);
    }
  };


  // 🧠 SMART URL PREDICTOR (Fixes Next Button)
  const predictNextUrl = useCallback((currentUrl: string) => {
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
  }, []);

  const predictPrevUrl = useCallback((currentUrl: string) => {
    const match = currentUrl.match(/(\d+)(\/?)$/);
    if (match) {
      const num = parseInt(match[1]);
      if (num > 1) return currentUrl.replace(match[1], (num - 1).toString());
    }
    return null;
  }, []);

  const loadChapter = useCallback(async (chapter: ChapterData) => {
    setUrl(chapter.novelUrl);
    setOriginalContent(chapter.originalText);
    setTranslatedContent(chapter.translatedText);
    setChapterTitle(chapter.chapterTitle);
    setNextUrl(chapter.nextUrl || null);
    setPrevUrl(chapter.prevUrl || null);
    setHistoryOpen(false);
    setError('');
    setIsSaved(true);
  }, []);

  const saveChapterData = useCallback(async () => {
    try {
      const chapterData: ChapterData = {
        novelUrl: url,
        chapterTitle: chapterTitle || 'Untitled',
        translatedText: translatedContent,
        originalText: originalContent,
        timestamp: Date.now(),
        nextUrl: nextUrl || undefined,
        prevUrl: prevUrl || undefined,
      };
      await saveChapter(chapterData);
      setIsSaved(true);
      await loadChapters();
    } catch (e) {
      console.error('Save failed', e);
    }
  }, [url, chapterTitle, translatedContent, originalContent, nextUrl, prevUrl]);

  const handleTranslate = useCallback(async (overrideUrl?: string) => {
    const targetUrl = overrideUrl || url;
    if (!targetUrl.trim()) return;

    // Check if online
    if (!isOnline) {
      toast.showWarning('You are offline', 'Please check your internet connection and try again.');
      return;
    }

    // Update state to match what we are fetching
    if (overrideUrl) setUrl(overrideUrl);

    // Check DB first (cache)
    try {
      const existing = await getChapter(targetUrl);
      if (existing) {
        await loadChapter(existing);
        toast.showInfo('Loaded from cache', 'This chapter was loaded from your saved history.');
        return;
      }
    } catch (e) {}

    setLoading(true);
    setError('');
    setOriginalContent('');
    setTranslatedContent('');
    setTranslationQuality(null);
    setIsSaved(false);
    setShowManualInput(false);

    try {
      // 1. Scrape with retry
      const scrapeResult = await retryWithBackoff(
        async () => {
          const jinaRes = await fetch(`https://r.jina.ai/${targetUrl}`, {
            headers: { 'Accept': 'text/markdown' }
          });
          if (!jinaRes.ok) {
            throw new Error(`Failed to fetch content (${jinaRes.status})`);
          }
          return jinaRes.text();
        },
        {
          maxRetries: 3,
          onRetry: (attempt, error) => {
            toast.showInfo('Retrying...', `Attempt ${attempt} to fetch content`);
          }
        }
      );

      if (!scrapeResult.success) {
        throw handleError(scrapeResult.error, { source: 'scraper' });
      }

      const markdown = scrapeResult.data!;
      
      if (!markdown || markdown.trim().length < 50) {
        // Content too short, offer manual input
        toast.showWarning(
          'Content extraction may have failed',
          'The extracted content seems too short. You can manually paste the content.',
          {
            action: {
              label: 'Paste Content Manually',
              onClick: () => setShowManualInput(true)
            }
          }
        );
        setLoading(false);
        return;
      }

      setOriginalContent(markdown);
      
      const titleMatch = markdown.match(/^#+\s*(.+)$/m);
      setChapterTitle(titleMatch ? titleMatch[1] : 'Untitled Chapter');

      // 2. Translate with retry
      const translateResult = await retryWithBackoff(
        async () => {
          const translateRes = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              text: markdown,
              sourceUrl: targetUrl 
            }),
          });

          if (!translateRes.ok) {
            const errorData = await translateRes.json().catch(() => ({}));
            throw new Error(errorData.message || `Translation failed (${translateRes.status})`);
          }

          return translateRes.json();
        },
        {
          maxRetries: 2,
          onRetry: (attempt, error) => {
            toast.showInfo('Retrying translation...', `Attempt ${attempt}`);
          }
        }
      );

      if (!translateResult.success) {
        const appError = handleError(translateResult.error, { source: 'translation' });
        toast.showAppError(appError, {
          label: 'Try Again',
          onClick: () => handleTranslate(targetUrl)
        });
        setLoading(false);
        return;
      }

      const { translatedText, confidence, model } = translateResult.data;
      setTranslatedContent(translatedText || '');

      // Validate translation quality
      const quality = validateTranslationQuality(markdown, translatedText);
      setTranslationQuality({
        score: quality.score,
        description: getQualityDescription(quality.score)
      });

      if (!quality.isAcceptable) {
        toast.showWarning(
          'Low Translation Quality',
          `Quality score: ${quality.score}/10 (${getQualityDescription(quality.score)}). ${quality.issues.join('. ')}`,
          {
            duration: 0,
            action: {
              label: 'Edit Translation',
              onClick: () => {
                setIsEditing(true);
                setEditedTranslation(translatedText);
              }
            }
          }
        );
      } else if (quality.warnings.length > 0) {
        toast.showInfo(
          'Translation Note',
          quality.warnings[0],
          { duration: 5000 }
        );
      }

      // Show which service was used
      if (model && model.includes('google-translate')) {
        toast.showInfo('Fallback Used', 'Google Translate was used as fallback (Gemini unavailable)');
      }

      // 3. Navigation (Regex + Heuristic Backup)
      let finalNext: string | null = markdown.match(/\[(?:Next|Continue|下一章)[^\]]*\]\(([^)]+)\)/i)?.[1] || null;
      if (!finalNext) finalNext = predictNextUrl(targetUrl);
      setNextUrl(finalNext);

      let finalPrev: string | null = markdown.match(/\[(?:Previous|Prev|上一章)[^\]]*\]\(([^)]+)\)/i)?.[1] || null;
      if (!finalPrev) finalPrev = predictPrevUrl(targetUrl);
      setPrevUrl(finalPrev);

      // 4. Save
      if (translatedText) {
        setTimeout(() => saveChapterData(), 500);
      }

      toast.showSuccess('Translation complete', 'Chapter loaded successfully');
      
    } catch (err: any) {
      const appError = handleError(err);
      setError(appError.userMessage);
      toast.showAppError(appError, {
        label: 'Retry',
        onClick: () => handleTranslate(targetUrl)
      });
    } finally {
      setLoading(false);
    }
  }, [url, isOnline, toast, loadChapter, predictNextUrl, predictPrevUrl, saveChapterData]);

  // Manual content input handler
  const handleManualSubmit = useCallback(async () => {
    if (!manualContent.trim()) {
      toast.showWarning('No content', 'Please paste some content to translate');
      return;
    }

    setOriginalContent(manualContent);
    setShowManualInput(false);
    setLoading(true);
    setTranslationQuality(null);

    try {
      const translateResult = await retryWithBackoff(
        async () => {
          const translateRes = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              text: manualContent,
              sourceUrl: url || 'manual-input'
            }),
          });

          if (!translateRes.ok) {
            const errorData = await translateRes.json().catch(() => ({}));
            throw new Error(errorData.message || 'Translation failed');
          }

          return translateRes.json();
        },
        {
          maxRetries: 2,
          onRetry: (attempt) => {
            toast.showInfo('Retrying translation...', `Attempt ${attempt}`);
          }
        }
      );

      if (translateResult.success) {
        const { translatedText } = translateResult.data;
        setTranslatedContent(translatedText);

        const quality = validateTranslationQuality(manualContent, translatedText);
        setTranslationQuality({
          score: quality.score,
          description: getQualityDescription(quality.score)
        });

        if (!quality.isAcceptable) {
          toast.showWarning(
            'Low Translation Quality',
            `Quality score: ${quality.score}/10. You may want to review and edit.`,
            {
              duration: 0,
              action: {
                label: 'Edit Translation',
                onClick: () => {
                  setIsEditing(true);
                  setEditedTranslation(translatedText);
                }
              }
            }
          );
        }

        toast.showSuccess('Translation complete', 'Manual content translated successfully');
      } else {
        throw translateResult.error;
      }
    } catch (err) {
      const appError = handleError(err, { source: 'translation' });
      toast.showAppError(appError);
    } finally {
      setLoading(false);
    }
  }, [manualContent, url, toast]);

  // Save edited translation
  const handleSaveEdit = useCallback(() => {
    setTranslatedContent(editedTranslation);
    setIsEditing(false);
    toast.showSuccess('Translation updated', 'Your edits have been saved');
    
    // Re-save to database if URL exists
    if (url && originalContent) {
      setTimeout(() => saveChapterData(), 100);
    }
  }, [editedTranslation, url, originalContent, toast, saveChapterData]);

  // Navigation Handlers
  const handleNext = () => {
    if (nextUrl) handleTranslate(nextUrl);
  };

  const handlePrev = () => {
    if (prevUrl) handleTranslate(prevUrl);
  };

  const handleDeleteChapter = async (e: React.MouseEvent, chapterUrl: string) => {
    e.stopPropagation();
    if (confirm('Delete this chapter?')) {
      await deleteChapter(chapterUrl);
      await loadChapters();
      if (url === chapterUrl) {
        setUrl('');
        setOriginalContent('');
        setTranslatedContent('');
        setIsSaved(false);
      }
    }
  };

  return (
    <div className='min-h-screen bg-[#fdfbf7]'>
      {/* Error Toast Container */}
      <ErrorToast toasts={toast.toasts} onDismiss={toast.dismissToast} />

      {/* Offline Indicator */}
      {!isOnline && (
        <div className='fixed top-0 left-0 right-0 bg-red-600 text-white py-2 px-4 text-center z-50 flex items-center justify-center gap-2'>
          <WifiOff className='w-4 h-4' />
          <span>You are offline. Some features are unavailable.</span>
        </div>
      )}

      {/* Mobile Header */}
      <div className={`lg:hidden bg-white border-b border-amber-200 sticky z-50 ${!isOnline ? 'top-10' : 'top-0'}`}>
        <div className='flex items-center justify-between p-4'>
          <div className='flex items-center gap-2'>
            <BookOpen className='w-6 h-6 text-amber-800' />
            <h1 className='text-xl font-bold text-amber-900'>Gemini Novel Reader</h1>
          </div>
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className='p-2 hover:bg-amber-50 rounded-lg transition-colors'
            aria-label='Toggle history'
          >
            {historyOpen ? <Menu className='w-6 h-6' /> : <Menu className='w-6 h-6' />}
          </button>
        </div>
      </div>

      <div className='flex'>
        {/* Sidebar */}
        <div className={`${historyOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} fixed lg:sticky top-0 h-screen w-80 bg-white border-r border-amber-200 z-40 transition-transform overflow-y-auto p-4`}>
          <div className='hidden lg:flex items-center gap-2 mb-4 font-bold text-amber-900'>
            <History className='w-5 h-5' />
            <span>History</span>
          </div>
          {savedChapters.length === 0 ? (
            <p className='text-gray-500 text-sm'>No saved chapters yet</p>
          ) : (
            savedChapters.map(c => (
              <div key={c.novelUrl} className='group relative mb-2'>
                <button
                  onClick={() => loadChapter(c)}
                  className='w-full text-left p-2 hover:bg-amber-50 rounded border border-transparent hover:border-amber-200 truncate text-sm'
                >
                  {c.chapterTitle}
                </button>
                <button
                  onClick={(e) => handleDeleteChapter(e, c.novelUrl)}
                  className='absolute right-1 top-1 p-1 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100'
                >
                  <Trash2 className='w-4 h-4' />
                </button>
              </div>
            ))
          )}
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
          <div className='flex gap-2 mb-4'>
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
              disabled={loading || !isOnline}
              className='bg-amber-600 text-white px-6 rounded-lg font-bold disabled:opacity-50 flex items-center gap-2'
            >
              {loading ? <Loader2 className='animate-spin w-5 h-5' /> : 'Translate'}
            </button>
          </div>

          <div className='flex gap-2 mb-8'>
            <button
              onClick={() => setShowManualInput(true)}
              className='text-sm text-amber-600 hover:text-amber-700 underline flex items-center gap-1'
            >
              <Edit3 className='w-4 h-4' />
              Paste content manually
            </button>
          </div>

          {error && <div className='bg-red-100 text-red-700 p-4 rounded mb-4'>{error}</div>}
          
          <div className='flex gap-4 mb-4 flex-wrap'>
            {isSaved && (
              <div className='text-green-600 flex gap-2 items-center'>
                <Check className='w-5 h-5' />
                <span>Saved</span>
              </div>
            )}
            
            {translationQuality && (
              <div className={`flex gap-2 items-center ${
                translationQuality.score >= 7 ? 'text-green-600' : 
                translationQuality.score >= 5 ? 'text-yellow-600' : 
                'text-red-600'
              }`}>
                <AlertTriangle className='w-5 h-5' />
                <span>Quality: {translationQuality.score}/10 ({translationQuality.description})</span>
              </div>
            )}
          </div>

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
                <div className='flex items-center justify-between mb-4 border-b pb-2'>
                  <h2 className='font-bold text-xl text-amber-900'>Translated</h2>
                  <button
                    onClick={() => {
                      setIsEditing(true);
                      setEditedTranslation(translatedContent);
                    }}
                    className='text-sm text-amber-600 hover:text-amber-700 flex items-center gap-1'
                  >
                    <Edit3 className='w-4 h-4' />
                    Edit
                  </button>
                </div>
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

      {/* Manual Input Modal */}
      {showManualInput && (
        <div className='fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4'>
          <div className='bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-y-auto'>
            <div className='p-6'>
              <h2 className='text-2xl font-bold text-amber-900 mb-4'>Paste Chapter Content</h2>
              <p className='text-gray-600 mb-4'>
                If automatic scraping failed, you can paste the chapter content here directly.
              </p>
              <textarea
                value={manualContent}
                onChange={(e) => setManualContent(e.target.value)}
                placeholder='Paste the chapter content here...'
                className='w-full h-64 border-2 border-amber-200 p-3 rounded-lg focus:outline-none focus:border-amber-400 font-mono text-sm'
              />
              <div className='flex gap-2 mt-4'>
                <button
                  onClick={handleManualSubmit}
                  disabled={loading || !manualContent.trim()}
                  className='flex-1 bg-amber-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2'
                >
                  {loading ? <Loader2 className='animate-spin w-5 h-5' /> : 'Translate'}
                </button>
                <button
                  onClick={() => {
                    setShowManualInput(false);
                    setManualContent('');
                  }}
                  className='px-6 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold'
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Translation Modal */}
      {isEditing && (
        <div className='fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4'>
          <div className='bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'>
            <div className='p-6'>
              <h2 className='text-2xl font-bold text-amber-900 mb-4'>Edit Translation</h2>
              <p className='text-gray-600 mb-4'>
                Make corrections or improvements to the translation.
              </p>
              <textarea
                value={editedTranslation}
                onChange={(e) => setEditedTranslation(e.target.value)}
                className='w-full h-96 border-2 border-amber-200 p-3 rounded-lg focus:outline-none focus:border-amber-400 font-serif text-base'
              />
              <div className='flex gap-2 mt-4'>
                <button
                  onClick={handleSaveEdit}
                  className='flex-1 bg-amber-600 text-white py-3 rounded-lg font-semibold'
                >
                  Save Changes
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditedTranslation('');
                  }}
                  className='px-6 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold'
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <ErrorBoundary>
      <HomeContent />
    </ErrorBoundary>
  );
}

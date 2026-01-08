'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, BookOpen, Menu, History, ChevronLeft, ChevronRight, Check, Trash2, Moon, Sun, Minus, Plus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { saveChapter, getChapter, deleteChapter, getAllChapters, type ChapterData } from './lib/storage';
import ReaderPane from './components/ReaderPane';
import ReaderControls from './components/ReaderControls';
import ReadingHistory from './components/ReadingHistory';
import InputForm from './components/InputForm';

export default function Home() {
  const [url, setUrl] = useState('');
  const [chapterUrl, setChapterUrl] = useState('');
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
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [textSize, setTextSize] = useState('medium');
  const [readingProgress, setReadingProgress] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  // Load theme preference from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    }

    const savedTextSize = localStorage.getItem('textSize');
    if (savedTextSize) setTextSize(savedTextSize);

    // Check if mobile
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Apply dark mode to document
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Save text size preference
  useEffect(() => {
    localStorage.setItem('textSize', textSize);
  }, [textSize]);

  const loadChapters = useCallback(async () => {
    try {
      const chapters = await getAllChapters();
      setSavedChapters(chapters);
    } catch (e) {
      console.error(e);
    }
  }, []);

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
  }, [loadChapters]);

  // Check saved status when content changes
  useEffect(() => {
    if (url && translatedContent) checkIfSaved();
  }, [url, translatedContent, checkIfSaved]);

  // Calculate reading progress
  useEffect(() => {
    const handleScroll = () => {
      if (typeof window !== 'undefined') {
        const scrollPosition = window.scrollY;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const progress = Math.round((scrollPosition / (documentHeight - windowHeight)) * 100);
        setReadingProgress(progress);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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
    setChapterUrl(chapter.novelUrl);
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
  }, [url, chapterTitle, translatedContent, originalContent, nextUrl, prevUrl, loadChapters]);

  const handleTranslate = useCallback(async (overrideUrl?: string) => {
    const targetUrl = overrideUrl || url;
    if (!targetUrl.trim()) return;

    // Update state to match what we are fetching
    if (overrideUrl) {
      setUrl(overrideUrl);
      setChapterUrl(overrideUrl);
    }

    // Check DB first
    try {
      const existing = await getChapter(targetUrl);
      if (existing) {
        loadChapter(existing);
        return;
      }
    } catch (e) {}

    setLoading(true);
    setError('');
    setOriginalContent('');
    setTranslatedContent('');
    setIsSaved(false);

    try {
      // 1. Scrape
      const jinaRes = await fetch(`https://r.jina.ai/${targetUrl}`, {
        headers: { 'Accept': 'text/markdown' }
      });
      if (!jinaRes.ok) throw new Error('Failed to fetch novel content');

      const markdown = await jinaRes.text();
      setOriginalContent(markdown);
      setChapterUrl(targetUrl);

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
      const nextMatch = markdown.match(/\[(?:Next|Continue|下一章)[^\]]*\]\(([^)]+)\)/i);
      let finalNext: string | null = nextMatch?.[1] || null;
      if (!finalNext) finalNext = predictNextUrl(targetUrl); // ✨ Use Heuristic if scraped link missing
      setNextUrl(finalNext);

      const prevMatch = markdown.match(/\[(?:Previous|Prev|上一章)[^\]]*\]\(([^)]+)\)/i);
      let finalPrev: string | null = prevMatch?.[1] || null;
      if (!finalPrev) finalPrev = predictPrevUrl(targetUrl);
      setPrevUrl(finalPrev);

      // 4. Save
      if (translatedText) {
        setTimeout(() => saveChapterData(), 500);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [url, loadChapter, predictNextUrl, predictPrevUrl, saveChapterData]);

  // Keyboard shortcuts for navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && prevUrl) {
        handleTranslate(prevUrl);
      } else if (e.key === 'ArrowRight' && nextUrl) {
        handleTranslate(nextUrl);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prevUrl, nextUrl, handleTranslate]);

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

  const extractChapterNumber = (url: string): string => {
    const match = url.match(/chapter[_-]?(\d+)/i);
    if (match) return match[1];
    const numMatch = url.match(/(\d+)\/?$/);
    if (numMatch) return numMatch[1];
    return '1';
  };

  // Calculate current chapter and total chapters
  const currentChapter = prevUrl ? (parseInt(extractChapterNumber(url)) || 1) : 1;
  const totalChapters = nextUrl ? currentChapter + 1 : currentChapter;

  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-[#fdfbf7] text-gray-800'}`}>
      {/* Mobile Header */}
      <div className='lg:hidden bg-white dark:bg-gray-800 border-b border-amber-200 dark:border-gray-700 sticky top-0 z-50'>
        <div className='flex items-center justify-between p-4'>
          <div className='flex items-center gap-2'>
            <BookOpen className='w-6 h-6 text-amber-800 dark:text-amber-400' />
            <h1 className='text-xl font-bold text-amber-900 dark:text-amber-300'>Gemini Novel Reader</h1>
          </div>
        </div>
      </div>

      <div className='flex'>
        {/* Reading History Sidebar */}
        <ReadingHistory
          savedChapters={savedChapters}
          onLoadChapter={loadChapter}
          onDeleteChapter={handleDeleteChapter}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen(!historyOpen)}
          isMobile={isMobile}
        />

        {/* Main Content */}
        <div className='flex-1 container mx-auto px-4 py-8 max-w-5xl'>
          {/* Desktop Header */}
          <div className='hidden lg:block text-center mb-8'>
            <div className='flex items-center justify-center gap-2 mb-4'>
              <BookOpen className='w-8 h-8 text-amber-800 dark:text-amber-400' />
              <h1 className='text-4xl font-bold text-amber-900 dark:text-amber-300'>Gemini Novel Reader</h1>
            </div>
            <p className='text-amber-700 dark:text-amber-300'>Translate and read novels with AI</p>
          </div>

          {/* Input Form */}
          <InputForm
            url={url}
            chapterUrl={chapterUrl}
            onUrlChange={setUrl}
            onChapterUrlChange={setChapterUrl}
            onSubmit={() => handleTranslate()}
            loading={loading}
            error={error}
            isMobile={isMobile}
          />

          {/* Success indicator */}
          {isSaved && (
            <div className='text-green-600 dark:text-green-400 flex gap-2 mb-4 items-center'>
              <Check className='w-5 h-5' />
              <span>Saved</span>
            </div>
          )}

          {/* Reader Controls */}
          {(originalContent || translatedContent) && (
            <ReaderControls
              chapterTitle={chapterTitle}
              currentChapter={currentChapter.toString()}
              totalChapters={totalChapters}
              onPrev={handlePrev}
              onNext={handleNext}
              hasPrev={!!prevUrl}
              hasNext={!!nextUrl}
              isDarkMode={isDarkMode}
              onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
              textSize={textSize}
              onTextSizeChange={setTextSize}
              loading={loading}
            />
          )}

          {/* Reader Panes */}
          {(originalContent || translatedContent) && (
            <ReaderPane
              originalContent={originalContent}
              translatedContent={translatedContent}
              chapterTitle={chapterTitle}
              currentChapter={currentChapter.toString()}
              totalChapters={totalChapters}
              readingProgress={readingProgress}
              textSize={textSize}
              isDarkMode={isDarkMode}
            />
          )}

          {/* Mobile Navigation */}
          {(nextUrl || prevUrl) && isMobile && (
            <div className='fixed bottom-6 left-1/2 -translate-x-1/2 flex gap-4 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm p-2 rounded shadow border border-amber-200 dark:border-gray-700 z-50'>
              <button
                disabled={!prevUrl}
                onClick={handlePrev}
                className='flex gap-2 px-4 py-2 bg-amber-600 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed'
                aria-label='Previous chapter'
              >
                <ChevronLeft className='w-5 h-5' />
                <span className='hidden sm:inline'>Prev</span>
              </button>
              <button
                disabled={!nextUrl}
                onClick={handleNext}
                className='flex gap-2 px-4 py-2 bg-amber-600 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed'
                aria-label='Next chapter'
              >
                <span className='hidden sm:inline'>Next</span>
                <ChevronRight className='w-5 h-5' />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

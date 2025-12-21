'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, BookOpen, Menu, History, ChevronLeft, ChevronRight, Check, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { saveChapter, getChapter, deleteChapter, getAllChapters, type ChapterData } from './lib/storage';

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
  const [savedChapters, setSavedChapters] = useState<ChapterData[]>([]);
  const [isSaved, setIsSaved] = useState(false);
  const [jumpToInput, setJumpToInput] = useState('');

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

  const loadChapter = async (chapter: ChapterData) => {
    setUrl(chapter.novelUrl);
    setOriginalContent(chapter.originalText);
    setTranslatedContent(chapter.translatedText);
    setChapterTitle(chapter.chapterTitle);
    setNextUrl(chapter.nextUrl || null);
    setPrevUrl(chapter.prevUrl || null);
    setHistoryOpen(false);
    setError('');
    setIsSaved(true);
  };

  const saveChapterData = async () => {
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
  };

  const handleTranslate = async (overrideUrl?: string) => {
    const targetUrl = overrideUrl || url;
    if (!targetUrl.trim()) return;

    // Update state to match what we are fetching
    if (overrideUrl) setUrl(overrideUrl);

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
      if (!finalNext) finalNext = predictNextUrl(targetUrl); // ✨ Use Heuristic if scraped link missing
      setNextUrl(finalNext);

      let finalPrev: string | null = markdown.match(/\[(?:Previous|Prev|上一章)[^\]]*\]\(([^)]+)\)/i)?.[1] || null;
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
  };

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
      {/* Mobile Header */}
      <div className='lg:hidden bg-white border-b border-amber-200 sticky top-0 z-50'>
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

'use client';

import { useState } from 'react';
import { Loader2, BookOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function Home() {
  const [url, setUrl] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [translatedContent, setTranslatedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleTranslate = async () => {
    if (!url.trim()) {
      setError('Please enter a valid URL');
      return;
    }

    setLoading(true);
    setError('');
    setOriginalContent('');
    setTranslatedContent('');

    try {
      // Fetch content from Jina.ai
      const jinaUrl = `https://r.jina.ai/${url}`;
      const response = await fetch(jinaUrl, {
        headers: {
          'Accept': 'text/markdown',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch content: ${response.statusText}`);
      }

      const markdown = await response.text();
      setOriginalContent(markdown);

      // Translate using Gemini API
      const translateResponse = await fetch('/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: markdown }),
      });

      if (!translateResponse.ok) {
        const errorData = await translateResponse.json();
        throw new Error(errorData.error || 'Translation failed');
      }

      const { translated } = await translateResponse.json();
      setTranslatedContent(translated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setOriginalContent('');
      setTranslatedContent('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fdfbf7]">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <BookOpen className="w-8 h-8 text-amber-800" />
            <h1 className="text-4xl font-bold text-amber-900">Gemini Novel Reader</h1>
          </div>
          <p className="text-amber-700">Translate and read novels with AI</p>
        </div>

        {/* Input Section */}
        <div className="max-w-4xl mx-auto mb-8">
          <div className="flex gap-4">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter novel URL (e.g., https://example.com/novel)"
              className="flex-1 px-4 py-3 border-2 border-amber-200 rounded-lg focus:outline-none focus:border-amber-400 bg-white text-gray-800 placeholder-gray-400"
              onKeyDown={(e) => e.key === 'Enter' && handleTranslate()}
              disabled={loading}
            />
            <button
              onClick={handleTranslate}
              disabled={loading}
              className="px-8 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Translating...
                </>
              ) : (
                'Translate'
              )}
            </button>
          </div>
          {error && (
            <div className="mt-4 p-4 bg-red-100 border border-red-300 rounded-lg text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Content Display - Split View */}
        {(originalContent || translatedContent) && (
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Original Content */}
            <div className="bg-white rounded-lg shadow-lg p-6 border border-amber-100">
              <h2 className="text-2xl font-bold text-amber-900 mb-4 pb-2 border-b border-amber-200">
                Original
              </h2>
              <div className="prose prose-lg max-w-none font-serif text-gray-800 leading-relaxed">
                <ReactMarkdown>{originalContent}</ReactMarkdown>
              </div>
            </div>

            {/* Translated Content */}
            <div className="bg-white rounded-lg shadow-lg p-6 border border-amber-100">
              <h2 className="text-2xl font-bold text-amber-900 mb-4 pb-2 border-b border-amber-200">
                Translated
              </h2>
              <div className="prose prose-lg max-w-none font-serif text-gray-800 leading-relaxed">
                <ReactMarkdown>{translatedContent}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


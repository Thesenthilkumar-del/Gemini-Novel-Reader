'use client';

import React from 'react';
import { Loader2, BookOpen } from 'lucide-react';

interface InputFormProps {
  url: string;
  chapterUrl: string;
  onUrlChange: (value: string) => void;
  onChapterUrlChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string;
  isMobile: boolean;
}

export default function InputForm({
  url,
  chapterUrl,
  onUrlChange,
  onChapterUrlChange,
  onSubmit,
  loading,
  error,
  isMobile,
}: InputFormProps) {
  return (
    <div className="flex flex-col gap-4 mb-8">
      {/* Main URL Input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="Paste Novel URL..."
            className={`w-full border-2 border-amber-200 p-3 rounded-lg focus:outline-none focus:border-amber-400 pr-10 ${isMobile ? 'text-sm' : ''}`}
            disabled={loading}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
            aria-label="Novel URL"
          />
          <BookOpen className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-amber-400" />
        </div>
        <button
          onClick={onSubmit}
          disabled={loading}
          className={`bg-amber-600 text-white px-6 rounded-lg font-bold disabled:opacity-50 flex items-center gap-2 whitespace-nowrap ${isMobile ? 'px-4 py-3' : ''}`}
          aria-label="Translate"
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin w-5 h-5" />
              <span className="hidden sm:inline">Loading...</span>
            </>
          ) : (
            <>
              <span className="hidden sm:inline">Translate</span>
              <span className="sm:hidden">Go</span>
            </>
          )}
        </button>
      </div>

      {/* Chapter URL Input (auto-filled) */}
      {chapterUrl && (
        <div className="flex gap-2">
          <input
            value={chapterUrl}
            onChange={(e) => onChapterUrlChange(e.target.value)}
            placeholder="Chapter URL (auto-filled)"
            className={`flex-1 border-2 border-amber-100 p-3 rounded-lg bg-gray-50 ${isMobile ? 'text-sm' : ''}`}
            disabled={true}
            aria-label="Chapter URL"
          />
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-100 text-red-700 p-4 rounded text-sm" role="alert">
          <div className="flex items-center gap-2">
            <span className="font-medium">Error:</span>
            <span>{error}</span>
          </div>
          <button
            onClick={onSubmit}
            className="mt-2 bg-red-500 text-white px-3 py-1 rounded text-xs hover:bg-red-600 transition-colors"
            disabled={loading}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

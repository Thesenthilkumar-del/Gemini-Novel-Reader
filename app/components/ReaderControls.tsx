'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, Moon, Sun, Minus, Plus } from 'lucide-react';

interface ReaderControlsProps {
  chapterTitle: string;
  currentChapter: string;
  totalChapters: number | null;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  textSize: string;
  onTextSizeChange: (size: string) => void;
  loading: boolean;
}

export default function ReaderControls({
  chapterTitle,
  currentChapter,
  totalChapters,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  isDarkMode,
  onToggleDarkMode,
  textSize,
  onTextSizeChange,
  loading,
}: ReaderControlsProps) {
  return (
    <div className="flex flex-col gap-4 mb-8">
      {/* Chapter Title and Info */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <h2 className="text-2xl font-bold text-amber-900 truncate max-w-[70%]">
          {chapterTitle || 'Untitled Chapter'}
        </h2>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          {currentChapter && totalChapters !== null && (
            <span>Chapter {currentChapter} of {totalChapters}</span>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onTextSizeChange('small')}
              className={`p-1 ${textSize === 'small' ? 'bg-amber-100' : ''}`}
              aria-label="Small text size"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              onClick={() => onTextSizeChange('medium')}
              className={`p-1 ${textSize === 'medium' ? 'bg-amber-100' : ''}`}
              aria-label="Medium text size"
            >
              A
            </button>
            <button
              onClick={() => onTextSizeChange('large')}
              className={`p-1 ${textSize === 'large' ? 'bg-amber-100' : ''}`}
              aria-label="Large text size"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={onToggleDarkMode}
              className="p-1"
              aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Controls */}
      <div className="flex gap-4">
        <button
          onClick={onPrev}
          disabled={!hasPrev || loading}
          className="flex gap-2 px-4 py-2 bg-amber-600 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed items-center"
          aria-label="Previous chapter"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="hidden sm:inline">Prev</span>
        </button>
        <button
          onClick={onNext}
          disabled={!hasNext || loading}
          className="flex gap-2 px-4 py-2 bg-amber-600 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed items-center"
          aria-label="Next chapter"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

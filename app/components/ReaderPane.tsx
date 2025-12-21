'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';

interface ReaderPaneProps {
  originalContent: string;
  translatedContent: string;
  chapterTitle: string;
  currentChapter: string;
  totalChapters: number | null;
  readingProgress: number;
  textSize: string;
  isDarkMode: boolean;
}

export default function ReaderPane({
  originalContent,
  translatedContent,
  chapterTitle,
  currentChapter,
  totalChapters,
  readingProgress,
  textSize,
  isDarkMode,
}: ReaderPaneProps) {
  // Determine text size classes
  const getTextSizeClass = () => {
    switch (textSize) {
      case 'small': return 'text-sm';
      case 'large': return 'text-lg';
      default: return 'text-base';
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-8 w-full">
      {/* Left Pane - Original Content (hidden on mobile) */}
      <div className="hidden lg:block bg-white p-6 rounded shadow border border-amber-100 h-[calc(100vh-200px)] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-xl text-amber-900 border-b pb-2">Original</h2>
          <span className="text-sm text-gray-500">
            {currentChapter && totalChapters !== null ? 
              `Chapter ${currentChapter} of ${totalChapters}` : ''}
          </span>
        </div>
        <div className={`prose max-w-none font-serif ${getTextSizeClass()} ${isDarkMode ? 'text-gray-300' : 'text-gray-800'} leading-relaxed`}>
          <ReactMarkdown>{originalContent}</ReactMarkdown>
        </div>
      </div>

      {/* Right Pane - Translated Content */}
      <div className={`bg-white p-6 rounded shadow border border-amber-100 h-[calc(100vh-200px)] overflow-y-auto lg:h-[calc(100vh-200px)]`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-xl text-amber-900 border-b pb-2">Translated</h2>
          <span className="text-sm text-gray-500">
            {currentChapter && totalChapters !== null ? 
              `Chapter ${currentChapter} of ${totalChapters}` : ''}
          </span>
        </div>
        <div className={`prose max-w-none font-serif ${getTextSizeClass()} ${isDarkMode ? 'text-gray-300' : 'text-gray-800'} leading-relaxed`}>
          <ReactMarkdown>{translatedContent}</ReactMarkdown>
        </div>
        {/* Reading Progress Indicator */}
        {readingProgress > 0 && (
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-amber-600 h-2 rounded-full" 
                style={{ width: `${readingProgress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-500 mt-1">Reading Progress: {readingProgress}%</p>
          </div>
        )}
      </div>
    </div>
  );
}

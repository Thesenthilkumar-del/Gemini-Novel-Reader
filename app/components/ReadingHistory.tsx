'use client';

import React from 'react';
import { History, Trash2, BookOpen, Clock } from 'lucide-react';
import { type ChapterData } from '../lib/storage';

interface ReadingHistoryProps {
  savedChapters: ChapterData[];
  onLoadChapter: (chapter: ChapterData) => void;
  onDeleteChapter: (e: React.MouseEvent, chapterUrl: string) => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  isMobile: boolean;
}

export default function ReadingHistory({
  savedChapters,
  onLoadChapter,
  onDeleteChapter,
  historyOpen,
  onToggleHistory,
  isMobile,
}: ReadingHistoryProps) {
  return (
    <>
      {/* Mobile History Toggle Button */}
      {isMobile && (
        <button
          onClick={onToggleHistory}
          className="lg:hidden fixed top-4 right-4 p-2 bg-white/90 backdrop-blur-sm rounded-lg shadow border border-amber-200 z-50"
          aria-label="Toggle reading history"
        >
          <History className="w-6 h-6 text-amber-800" />
        </button>
      )}

      {/* History Sidebar */}
      <div className={`fixed lg:sticky top-0 h-screen w-80 bg-white border-r border-amber-200 z-40 transition-transform overflow-y-auto p-4 ${historyOpen || !isMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <History className="w-5 h-5" />
            <span>Reading History</span>
          </div>
          {isMobile && (
            <button
              onClick={onToggleHistory}
              className="p-1 text-gray-500 hover:text-gray-700"
              aria-label="Close history"
            >
              <span className="text-xl">×</span>
            </button>
          )}
        </div>

        {savedChapters.length === 0 ? (
          <div className="text-gray-500 text-sm flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            <span>No saved chapters yet</span>
          </div>
        ) : (
          <div className="space-y-2">
            {savedChapters.map((chapter) => (
              <div key={chapter.novelUrl} className="group relative">
                <button
                  onClick={() => onLoadChapter(chapter)}
                  className="w-full text-left p-3 hover:bg-amber-50 rounded border border-transparent hover:border-amber-200 transition-colors text-sm flex flex-col gap-1"
                >
                  <div className="font-medium text-amber-900 truncate">{chapter.chapterTitle}</div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(chapter.timestamp).toLocaleString()}</span>
                  </div>
                  {chapter.translatedText && (
                    <div className="text-xs text-gray-400 truncate mt-1">
                      {Math.min(50, Math.floor((chapter.translatedText.length / 100)))}% read
                    </div>
                  )}
                </button>
                <button
                  onClick={(e) => onDeleteChapter(e, chapter.novelUrl)}
                  className="absolute right-2 top-2 p-1 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Delete chapter"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mobile Overlay */}
      {isMobile && historyOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={onToggleHistory}
          aria-hidden="true"
        />
      )}
    </>
  );
}

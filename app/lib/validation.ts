
export function isEnglish(text: string): boolean {
  if (!text || text.length === 0) return false;
  
  // 1. Check character range (English uses ASCII mostly)
  // Allow some punctuation and common latin supplements, but should be mostly Basic Latin
  const asciiCount = (text.match(/[\u0000-\u007F]/g) || []).length;
  const ratio = asciiCount / text.length;
  
  // If less than 70% is ASCII, probably not English (relaxed from 80% to account for formatting chars or some names)
  if (ratio < 0.7) return false; 
  
  // 2. Check for common stop words to ensure it's actual English sentences
  // We check only a subset of most common words
  const stopWords = new Set(['the', 'and', 'is', 'in', 'to', 'of', 'it', 'that', 'was', 'for', 'with', 'he', 'she', 'they']);
  
  // Sample the text to avoid processing huge strings entirely if not needed? 
  // But regex split is fast enough for chapter size usually.
  const words = text.toLowerCase().split(/[\s\.,;!?()"']+/).filter(w => w.length > 0);
  
  if (words.length < 5) {
      // Very short text, hard to judge by stop words. Rely on ASCII ratio.
      return true; 
  }

  const foundStopWordsCount = words.reduce((count, word) => count + (stopWords.has(word) ? 1 : 0), 0);
  
  // Expect at least some stop words. E.g. 5% of words should be stop words?
  // English text usually consists of ~50% function words.
  // Let's be conservative: at least 1 stop word if > 10 words, or checking density.
  
  if (words.length > 10 && foundStopWordsCount === 0) return false;
  
  return true;
}

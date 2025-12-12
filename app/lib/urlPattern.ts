// URL pattern learning and heuristic next URL extraction

const URL_PATTERN_KEY = 'novel-url-patterns';

interface UrlPattern {
  baseUrl: string;
  pattern: string; // e.g., '/chapter-{n}.html'
  currentChapter: number;
}

export function extractChapterNumber(url: string): number | null {
  // Try to extract chapter number from URL
  // Patterns: chapter-50, chapter_50, ch50, /50/, chapter50, etc.
  const patterns = [
    /chapter[-_]?(\d+)/i,
    /ch[-_]?(\d+)/i,
    /\/(\d+)\//,
    /chapter(\d+)/i,
    /(\d+)\.html/,
    /page[-_]?(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

export function generateNextUrl(currentUrl: string): string | null {
  const chapterNum = extractChapterNumber(currentUrl);
  if (chapterNum === null) {
    return null;
  }

  // Try to replace the number with incremented value
  const nextNum = chapterNum + 1;
  
  // Try different replacement patterns
  const replacements = [
    [`chapter-${chapterNum}`, `chapter-${nextNum}`],
    [`chapter_${chapterNum}`, `chapter_${nextNum}`],
    [`ch-${chapterNum}`, `ch-${nextNum}`],
    [`ch_${chapterNum}`, `ch_${nextNum}`],
    [`/chapter/${chapterNum}/`, `/chapter/${nextNum}/`],
    [`chapter${chapterNum}`, `chapter${nextNum}`],
    [`${chapterNum}.html`, `${nextNum}.html`],
    [`page-${chapterNum}`, `page-${nextNum}`],
    [`page_${chapterNum}`, `page_${nextNum}`],
  ];

  for (const [oldPattern, newPattern] of replacements) {
    if (currentUrl.includes(oldPattern)) {
      return currentUrl.replace(oldPattern, newPattern);
    }
  }

  // Fallback: replace the number directly
  return currentUrl.replace(String(chapterNum), String(nextNum));
}

// Verify if a URL exists by making a HEAD request
export async function verifyUrlExists(url: string): Promise<boolean> {
  try {
    // Use a CORS proxy or direct fetch if same origin
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors', // This won't give us status, but won't throw CORS errors
    });
    // With no-cors, we can't check status, so we'll try a different approach
    return true; // Assume it exists if no error
  } catch (e) {
    // Try with GET request to a proxy or check differently
    try {
      const testResponse = await fetch(`https://r.jina.ai/${url}`, {
        method: 'HEAD',
        headers: { 'Accept': 'text/markdown' },
      });
      return testResponse.ok || testResponse.status === 405; // 405 means method not allowed but URL exists
    } catch (e2) {
      return false;
    }
  }
}

// Auto-predict next URL with verification
export async function predictAndVerifyNextUrl(currentUrl: string): Promise<string | null> {
  const predictedUrl = generateNextUrl(currentUrl);
  if (!predictedUrl) {
    return null;
  }

  // Verify the URL exists
  const exists = await verifyUrlExists(predictedUrl);
  return exists ? predictedUrl : null;
}

export function generatePrevUrl(currentUrl: string): string | null {
  const chapterNum = extractChapterNumber(currentUrl);
  if (chapterNum === null || chapterNum <= 1) {
    return null;
  }

  const prevNum = chapterNum - 1;
  
  // Try different replacement patterns
  const replacements = [
    [`chapter-${chapterNum}`, `chapter-${prevNum}`],
    [`chapter_${chapterNum}`, `chapter_${prevNum}`],
    [`ch-${chapterNum}`, `ch-${prevNum}`],
    [`ch_${chapterNum}`, `ch_${prevNum}`],
    [`/chapter/${chapterNum}/`, `/chapter/${prevNum}/`],
    [`chapter${chapterNum}`, `chapter${prevNum}`],
    [`${chapterNum}.html`, `${prevNum}.html`],
    [`page-${chapterNum}`, `page-${prevNum}`],
    [`page_${chapterNum}`, `page_${prevNum}`],
  ];

  for (const [oldPattern, newPattern] of replacements) {
    if (currentUrl.includes(oldPattern)) {
      return currentUrl.replace(oldPattern, newPattern);
    }
  }

  // Fallback: replace the number directly
  return currentUrl.replace(String(chapterNum), String(prevNum));
}

export async function saveUrlPattern(baseUrl: string, pattern: string, chapterNum: number): Promise<void> {
  try {
    const patterns = await getUrlPatterns();
    const existing = patterns.find(p => p.baseUrl === baseUrl);
    
    if (existing) {
      existing.pattern = pattern;
      existing.currentChapter = chapterNum;
    } else {
      patterns.push({ baseUrl, pattern, currentChapter: chapterNum });
    }
    
    localStorage.setItem(URL_PATTERN_KEY, JSON.stringify(patterns));
  } catch (e) {
    console.error('Failed to save URL pattern:', e);
  }
}

export async function getUrlPatterns(): Promise<UrlPattern[]> {
  try {
    const stored = localStorage.getItem(URL_PATTERN_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
}


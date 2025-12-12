import { get, set, del, keys } from 'idb-keyval';

export interface ChapterData {
  novelUrl: string;
  chapterTitle: string;
  translatedText: string;
  originalText: string;
  audioBlob?: string; // base64 encoded audio
  imageUrl?: string; // base64 encoded image or URL
  timestamp: number;
  nextUrl?: string;
  prevUrl?: string;
}

const STORE_KEY_PREFIX = 'chapter:';

export async function saveChapter(data: ChapterData): Promise<void> {
  const key = `${STORE_KEY_PREFIX}${data.novelUrl}`;
  await set(key, data);
}

export async function getChapter(novelUrl: string): Promise<ChapterData | null> {
  const key = `${STORE_KEY_PREFIX}${novelUrl}`;
  const data = await get<ChapterData>(key);
  return data || null;
}

export async function deleteChapter(novelUrl: string): Promise<void> {
  const key = `${STORE_KEY_PREFIX}${novelUrl}`;
  await del(key);
}

export async function getAllChapters(): Promise<ChapterData[]> {
  const allKeys = await keys<string>();
  const chapterKeys = allKeys.filter(key => key.startsWith(STORE_KEY_PREFIX));
  const chapters = await Promise.all(
    chapterKeys.map(key => get<ChapterData>(key))
  );
  return chapters.filter((chapter): chapter is ChapterData => chapter !== undefined).sort((a, b) => b.timestamp - a.timestamp);
}


import pool from './db';
import crypto from 'crypto';

export interface CachedTranslation {
  translatedText: string;
  originalText: string;
  model: string;
  timestamp: number;
}

let initialized = false;

export class TranslationCacheDB {
  
  private async ensureTable() {
    if (initialized) return;
    
    const query = `
      CREATE TABLE IF NOT EXISTS translations (
        id SERIAL PRIMARY KEY,
        source_url_hash VARCHAR(64) NOT NULL,
        chapter_number VARCHAR(50) NOT NULL,
        original_text_hash VARCHAR(64) NOT NULL,
        translated_text TEXT NOT NULL,
        original_text TEXT,
        model VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_url_hash, chapter_number, original_text_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_translations_lookup ON translations(source_url_hash, chapter_number);
    `;
    
    try {
      await pool.query(query);
      initialized = true;
    } catch (error) {
      console.error('Failed to initialize translations table:', error);
      // Don't set initialized to true so we try again? 
      // Or maybe we can't write to DB.
    }
  }

  private hash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  async get(sourceUrl: string, chapterNumber: string, originalText: string): Promise<CachedTranslation | null> {
    await this.ensureTable();
    
    const urlHash = this.hash(sourceUrl);
    const textHash = this.hash(originalText);
    
    const query = `
      SELECT translated_text, original_text, model, created_at
      FROM translations
      WHERE source_url_hash = $1 
        AND chapter_number = $2 
        AND original_text_hash = $3
      LIMIT 1
    `;
    
    try {
      const result = await pool.query(query, [urlHash, chapterNumber, textHash]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          translatedText: row.translated_text,
          originalText: row.original_text || originalText,
          model: row.model,
          timestamp: new Date(row.created_at).getTime()
        };
      }
    } catch (error) {
      console.error('Database cache get error:', error);
      return null;
    }
    
    return null;
  }

  async set(sourceUrl: string, chapterNumber: string, originalText: string, translatedText: string, model: string): Promise<void> {
    await this.ensureTable();

    const urlHash = this.hash(sourceUrl);
    const textHash = this.hash(originalText);
    
    const query = `
      INSERT INTO translations (source_url_hash, chapter_number, original_text_hash, translated_text, original_text, model)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (source_url_hash, chapter_number, original_text_hash) 
      DO UPDATE SET 
        translated_text = EXCLUDED.translated_text,
        model = EXCLUDED.model,
        created_at = CURRENT_TIMESTAMP
    `;
    
    try {
      await pool.query(query, [urlHash, chapterNumber, textHash, translatedText, originalText, model]);
    } catch (error) {
      console.error('Database cache set error:', error);
    }
  }
}

export const translationCache = new TranslationCacheDB();

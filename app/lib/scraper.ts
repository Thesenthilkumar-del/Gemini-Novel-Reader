import { NextResponse } from 'next/server';
import { cacheHelpers } from './cache';

interface ScrapeResult {
  content: string;
  sourceUrl: string;
  title?: string;
  error?: string;
  usedCache?: boolean;
}

interface ScrapeOptions {
  timeout?: number;
  userAgent?: string;
  maxSize?: number;
}

interface RequiredScrapeOptions {
  timeout: number;
  userAgent: string;
  maxSize: number;
}

export class UniversalScraper {
  private defaultOptions: RequiredScrapeOptions = {
    timeout: 60000,
    userAgent: 'Gemini Novel Reader/1.0',
    maxSize: 1 * 1024 * 1024 // 1MB
  };

  constructor() {
    // Initialize with default options
  }

  private validateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  private validateContent(content: string): boolean {
    if (!content || content.trim().length === 0) {
      return false;
    }

    // Basic content validation
    if (content.length > (this.defaultOptions.maxSize || 1000000)) {
      return false;
    }

    // Check if content looks like it has actual text
    const textOnly = content.replace(/<[^>]*>/g, ' ');
    if (textOnly.trim().length < 100) { // Minimum 100 characters of actual text
      return false;
    }

    return true;
  }

  private cleanContent(content: string): string {
    // Basic content cleaning - remove scripts, styles, and common ad patterns
    return content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/class="[^"]*"/gi, '')
      .replace(/id="[^"]*"/gi, '')
      .replace(/style="[^"]*"/gi, '');
  }

  private async fetchWithTimeout(url: string, options: ScrapeOptions): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || this.defaultOptions.timeout);

    try {
      const headers: Record<string, string> = {
          'User-Agent': options.userAgent || this.defaultOptions.userAgent,
          'Accept': 'text/plain, text/markdown, text/html;q=0.9, */*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        };

      const response = await fetch(url, {
        method: 'GET',
        headers: headers,
        signal: controller.signal,
        redirect: 'follow'
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
    try {
      // Validate URL
      if (!this.validateUrl(url)) {
        return {
          content: '',
          sourceUrl: url,
          error: 'Invalid URL format'
        };
      }

      // Use r.jina.ai as the scraping proxy (existing infrastructure)
      const scrapeUrl = `https://r.jina.ai/${url}`;

      const scrapeOptions = { ...this.defaultOptions, ...options };
      const response = await this.fetchWithTimeout(scrapeUrl, scrapeOptions);

      if (!response.ok) {
        return {
          content: '',
          sourceUrl: url,
          error: `HTTP error ${response.status}: ${response.statusText}`
        };
      }

      let content = await response.text();

      // Clean and validate content
      content = this.cleanContent(content);

      if (!this.validateContent(content)) {
        return {
          content: '',
          sourceUrl: url,
          error: 'Scraped content is invalid or empty'
        };
      }

      return {
        content,
        sourceUrl: url,
        title: this.extractTitleFromContent(content) || 'Untitled Chapter'
      };

    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown scraping error';
      return {
        content: '',
        sourceUrl: url,
        error: errorMessage
      };
    }
  }

  private extractTitleFromContent(content: string): string | null {
    // Try to extract title from common HTML patterns
    const titlePatterns = [
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<title[^>]*>([^<]+)<\/title>/i,
      /<h2[^>]*>([^<]+)<\/h2>/i,
      /<h3[^>]*>([^<]+)<\/h3>/i
    ];

    for (const pattern of titlePatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    // Try to extract from first paragraph or heading
    const firstLineMatch = content.match(/^\s*([^\n]{10,100})/);
    if (firstLineMatch && firstLineMatch[1]) {
      return firstLineMatch[1].trim();
    }

    return null;
  }

  async scrapeWithFallback(url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
    // First try with the main scrape method
    const result = await this.scrape(url, options);
    
    // If it failed, we could add fallback logic here
    // For now, just return the result
    return result;
  }
}

// Export singleton instance
export const scraper = new UniversalScraper();
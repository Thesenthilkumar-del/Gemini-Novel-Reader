// Smart Chapter URL Prediction Engine
// Implements pattern detection, learning, and fallback scraping

import { NextResponse } from 'next/server';
import { cache } from './cache';
import { scraper } from './scraper';

export interface UrlPattern {
  domain: string;
  pattern: string; // Template pattern like '/chapter-{number}' or '/ch-{id}'
  exampleUrl: string; // Example URL used to learn the pattern
  chapterIdentifier: 'numeric' | 'alphanumeric'; // Type of chapter ID
  confidence: number; // 0-1 confidence score
  lastUsed: number;
  successRate: number; // Track accuracy over time
}

export interface PatternPrediction {
  nextUrl: string | null;
  previousUrl: string | null;
  pattern: UrlPattern | null;
  confidence: number;
  method: 'pattern' | 'scraping' | 'heuristic';
  sourceUrl: string;
}

export interface PatternValidationResult {
  nextUrl: string | null;
  previousUrl: string | null;
  confidence: number;
  validationErrors?: string[];
}

// Enhanced chapter extraction supporting multiple patterns and alphanumeric IDs
export function extractChapterIdentifier(url: string): { 
  identifier: string | null; 
  type: 'numeric' | 'alphanumeric' | null;
  pattern: string | null;
} {
  const urlObj = new URL(url);
  const path = urlObj.pathname + urlObj.search;

  // Define comprehensive pattern sets for different URL structures
  const patterns = [
    // Numeric patterns
    { regex: /chapter[-_]?s?[-_]?([0-9]+)/i, name: 'chapter-numeric', type: 'numeric' as const },
    { regex: /ch[-_]?([0-9]+)/i, name: 'ch-numeric', type: 'numeric' as const },
    { regex: /\/c(h)?[-_]?([0-9]+)\b/i, name: 'slash-c-numeric', type: 'numeric' as const },
    { regex: /\/([0-9]+)\/([^/]*)$/, name: 'slash-numeric', type: 'numeric' as const },
    { regex: /([0-9]+)\.html$/, name: 'html-numeric', type: 'numeric' as const },
    { regex: /page[-_]?([0-9]+)/i, name: 'page-numeric', type: 'numeric' as const },
    { regex: /part[-_]?([0-9]+)/i, name: 'part-numeric', type: 'numeric' as const },
    { regex: /vol[-_]?([0-9]+)/i, name: 'volume-numeric', type: 'numeric' as const },
    { regex: /episode[-_]?([0-9]+)/i, name: 'episode-numeric', type: 'numeric' as const },
    
    // Alphanumeric patterns (e.g., chapter-1a, ch-01b)
    { regex: /chapter[-_]?([0-9]+[a-z]?)/i, name: 'chapter-alphanumeric', type: 'alphanumeric' as const },
    { regex: /ch[-_]?([0-9]+[a-z]?)/i, name: 'ch-alphanumeric', type: 'alphanumeric' as const },
    { regex: /\/c(h)?[-_]?([0-9]+[a-z]?)\b/i, name: 'slash-c-alphanumeric', type: 'alphanumeric' as const },
    { regex: /([0-9]+[a-z]?)\.html$/, name: 'html-alphanumeric', type: 'alphanumeric' as const },
    
    // Special chapter patterns (e.g., prologue, epilogue, bonus)
    { regex: /(prologue|epilogue|bonus|extra|special)[-_]?([0-9]*)/i, name: 'special-chapter', type: 'alphanumeric' as const },
  ];

  for (const { regex, name, type } of patterns) {
    const match = path.match(regex);
    if (match) {
      // Find the captured group that's the identifier
      const identifier = match.slice(1).find(group => group && group.length > 0);
      if (identifier) {
        return {
          identifier,
          type,
          pattern: name
        };
      }
    }
  }

  return { identifier: null, type: null, pattern: null };
}

// Pattern detector that learns URL structure
export class PatternDetector {
  private static readonly PATTERN_KEY = 'url-patterns-v2';

  // Learn pattern from a URL
  static learnPattern(url: string): UrlPattern | null {
    const { identifier, type, pattern } = extractChapterIdentifier(url);
    if (!identifier || !pattern || !type) return null;

    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    
    // Create a templated pattern by replacing the identifier
    const templatedPattern = urlObj.pathname.replace(identifier, `{${type === 'numeric' ? 'number' : 'id'}}`);
    
    return {
      domain,
      pattern: templatedPattern + urlObj.search,
      exampleUrl: url,
      chapterIdentifier: type,
      confidence: 0.5, // Start with medium confidence
      lastUsed: Date.now(),
      successRate: 0.5
    };
  }

  // Update pattern confidence based on validation results
  static updatePatternConfidence(
    pattern: UrlPattern, 
    success: boolean, 
    domainPatterns: UrlPattern[]
  ): UrlPattern[] {
    const updatedPatterns = [...domainPatterns];
    const patternIndex = updatedPatterns.findIndex(p => 
      p.domain === pattern.domain && p.pattern === pattern.pattern
    );

    if (patternIndex >= 0) {
      const existingPattern = updatedPatterns[patternIndex];
      
      // Update success rate with a weighted average
      const weight = 0.3; // New results have 30% weight
      existingPattern.successRate = 
        (1 - weight) * existingPattern.successRate + weight * (success ? 1 : 0);
      
      // Update confidence based on success rate
      existingPattern.confidence = Math.min(0.95, existingPattern.successRate);
      existingPattern.lastUsed = Date.now();
      
      updatedPatterns[patternIndex] = existingPattern;
    }

    return updatedPatterns;
  }
}

// Generate next/previous URLs based on pattern
export class UrlGenerator {
  static generateNextUrl(url: string, pattern: UrlPattern): string | null {
    const { identifier, type } = extractChapterIdentifier(url);
    if (!identifier || !type) return null;

    let nextIdentifier: string;
    
    if (type === 'numeric') {
      const currentNum = parseInt(identifier, 10);
      if (isNaN(currentNum)) return null;
      nextIdentifier = (currentNum + 1).toString();
    } else {
      // Handle alphanumeric (e.g., 1a -> 1b, 1 -> 2)
      nextIdentifier = this.incrementAlphanumeric(identifier);
    }

    return url.replace(identifier, nextIdentifier);
  }

  static generatePrevUrl(url: string, pattern: UrlPattern): string | null {
    const { identifier, type } = extractChapterIdentifier(url);
    if (!identifier || !type) return null;

    let prevIdentifier: string;
    
    if (type === 'numeric') {
      const currentNum = parseInt(identifier, 10);
      if (isNaN(currentNum) || currentNum <= 1) return null;
      prevIdentifier = (currentNum - 1).toString();
    } else {
      // Handle alphanumeric
      prevIdentifier = this.decrementAlphanumeric(identifier);
      if (prevIdentifier === identifier) return null; // Can't go previous
    }

    return url.replace(identifier, prevIdentifier);
  }

  private static incrementAlphanumeric(id: string): string {
    const match = id.match(/([0-9]+)([a-z]?)/i);
    if (!match) return id;
    
    const [, num, letter] = match;
    const number = parseInt(num, 10);
    
    if (letter) {
      // Increment letter (e.g., 1a -> 1b)
      const nextChar = String.fromCharCode(letter.charCodeAt(0) + 1);
      return number + nextChar;
    } else {
      // No letter, increment number (e.g., 1 -> 2)
      return (number + 1).toString();
    }
  }

  private static decrementAlphanumeric(id: string): string {
    const match = id.match(/([0-9]+)([a-z]?)/i);
    if (!match) return id;
    
    const [, num, letter] = match;
    const number = parseInt(num, 10);
    
    if (letter) {
      // Decrement letter (e.g., 1b -> 1a)
      const prevChar = String.fromCharCode(letter.charCodeAt(0) - 1);
      return number + prevChar;
    } else {
      // No letter, decrement number (e.g., 2 -> 1)
      if (number <= 1) return id;
      return (number - 1).toString();
    }
  }
}

// Web scraper fallback for finding navigation links
export class NavigationScraper {
  static async scrapeNavigationLinks(url: string): Promise<{ nextUrl: string | null; prevUrl: string | null }> {
    try {
      // Try to get from cache first
      const cacheKey = `nav-links:${btoa(url)}`;
      const cached = await cache.getScrape(cacheKey);
      if (cached) {
        const navData = JSON.parse(cached.content);
        return { nextUrl: navData.nextUrl, prevUrl: navData.prevUrl };
      }

      // Scrape content using the existing scraper
      const scrapeResult = await scraper.scrape(url);
      if (scrapeResult.error || !scrapeResult.content) {
        return { nextUrl: null, prevUrl: null };
      }

      const content = scrapeResult.content;
      
      // Look for navigation patterns in markdown content
      const links = this.extractMarkdownLinks(content);
      const pageUrl = new URL(url);
      
      // Try to find next/previous links based on context
      const nextUrl = this.findNextLink(links, pageUrl) || 
                     this.findNextLinkInText(content, pageUrl);
      const prevUrl = this.findPrevLink(links, pageUrl) || 
                     this.findPrevLinkInText(content, pageUrl);

      // Cache the result
      const navData = { nextUrl, prevUrl };
      await cache.setScrape(cacheKey, JSON.stringify(navData), 24 * 60 * 60 * 1000);

      return { nextUrl, prevUrl };
    } catch (error) {
      console.error('Error scraping navigation links:', error);
      return { nextUrl: null, prevUrl: null };
    }
  }

  private static extractMarkdownLinks(content: string): Array<{ text: string; url: string }> {
    const links: Array<{ text: string; url: string }> = [];
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    
    while ((match = linkRegex.exec(content)) !== null) {
      links.push({
        text: match[1].toLowerCase(),
        url: match[2]
      });
    }
    
    return links;
  }

  private static findNextLink(links: Array<{ text: string; url: string }>, baseUrl: URL): string | null {
    const nextKeywords = ['next', 'continue', 'forward', '→', '>>', 'next chapter', 'next page', '下一章', '下一页', '次へ'];
    
    for (const link of links) {
      const text = link.text;
      if (nextKeywords.some(keyword => text.includes(keyword))) {
        try {
          return new URL(link.url, baseUrl).href;
        } catch {
          // Invalid URL, skip
        }
      }
    }
    
    return null;
  }

  private static findPrevLink(links: Array<{ text: string; url: string }>, baseUrl: URL): string | null {
    const prevKeywords = ['previous', 'prev', 'back', '←', '<<', 'previous chapter', 'previous page', '上一章', '上一页', '前へ'];
    
    for (const link of links) {
      const text = link.text;
      if (prevKeywords.some(keyword => text.includes(keyword))) {
        try {
          return new URL(link.url, baseUrl).href;
        } catch {
          // Invalid URL, skip
        }
      }
    }
    
    return null;
  }

  private static findNextLinkInText(content: string, baseUrl: URL): string | null {
    // Look for common navigation patterns in plain text
    const patterns = [
      /(?:next|continue).*?https?:\/\/[^\s]+/i,
      /https?:\/\/[^\s]+(?:\/chapter\/\d+\/)/i,
    ];
    
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        try {
          const urlMatch = match[0].match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            return new URL(urlMatch[0], baseUrl).href;
          }
        } catch {
          // Invalid URL, skip
        }
      }
    }
    
    return null;
  }

  private static findPrevLinkInText(content: string, baseUrl: URL): string | null {
    // Similar to findNextLinkInText but for previous links
    const patterns = [
      /(?:previous|prev|back).*?https?:\/\/[^\s]+/i,
    ];
    
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        try {
          const urlMatch = match[0].match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            return new URL(urlMatch[0], baseUrl).href;
          }
        } catch {
          // Invalid URL, skip
        }
      }
    }
    
    return null;
  }
}

// URL validator to check if predicted URLs exist
export class UrlValidator {
  static async validateUrl(url: string): Promise<boolean> {
    try {
      // Try to get from cache first
      const cacheKey = `url-valid:${btoa(url)}`;
      const cached = await cache.getScrape(cacheKey);
      if (cached) {
        return cached.content === 'valid';
      }

      // Use HEAD request to check if URL exists
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      try {
        const response = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'follow'
        });

        clearTimeout(timeoutId);
        const isValid = response.ok || response.status === 405 || response.status === 403;
        
        // Cache the result for 1 hour
        await cache.setScrape(cacheKey, isValid ? 'valid' : 'invalid', 60 * 60 * 1000);
        
        return isValid;
      } catch (error) {
        clearTimeout(timeoutId);
        
        // If HEAD fails, try GET with timeout and limited response
        try {
          const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            redirect: 'follow'
          });
          
          const isValid = response.ok;
          await cache.setScrape(cacheKey, isValid ? 'valid' : 'invalid', 60 * 60 * 1000);
          return isValid;
        } catch {
          await cache.setScrape(cacheKey, 'invalid', 60 * 60 * 1000);
          return false;
        }
      }
    } catch (error) {
      console.error('Error validating URL:', error);
      return false;
    }
  }

  static async validateUrls(urls: Array<string | null>): Promise<boolean[]> {
    const validations = await Promise.all(
      urls.map(url => url ? this.validateUrl(url) : Promise.resolve(false))
    );
    return validations;
  }
}
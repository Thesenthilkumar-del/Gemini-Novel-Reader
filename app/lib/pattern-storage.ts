import {
  extractChapterIdentifier,
  UrlGenerator,
  UrlValidator,
  NavigationScraper,
  PatternDetector,
  UrlPattern
} from './url-prediction';
import { cache } from './cache';

// Storage interface for URL patterns - can be backed by file system, PostgreSQL, or in-memory cache
export interface PatternStorage {
  getPatterns(): Promise<UrlPattern[]>;
  savePatterns(patterns: UrlPattern[]): Promise<void>;
  getPattern(domain: string): Promise<UrlPattern | null>;
  updatePattern(domain: string, updates: Partial<UrlPattern>): Promise<void>;
  addPattern(pattern: UrlPattern): Promise<void>;
}

// Production-ready storage using cache (in-memory) with persistence via cache
export class CachePatternStorage implements PatternStorage {
  private readonly CACHE_KEY = 'url-patterns-storage';

  async getPatterns(): Promise<UrlPattern[]> {
    const cached = await cache.getScrape(this.CACHE_KEY);
    if (cached) {
      return JSON.parse(cached.content);
    }
    return [];
  }

  async savePatterns(patterns: UrlPattern[]): Promise<void> {
    // Store patterns with 7 day TTL
    await cache.setScrape(this.CACHE_KEY, JSON.stringify(patterns), 7 * 24 * 60 * 60 * 1000);
  }

  async getPattern(domain: string): Promise<UrlPattern | null> {
    const patterns = await this.getPatterns();
    return patterns.find(p => p.domain === domain) || null;
  }

  async updatePattern(domain: string, updates: Partial<UrlPattern>): Promise<void> {
    const patterns = await this.getPatterns();
    const index = patterns.findIndex(p => p.domain === domain);
    
    if (index >= 0) {
      patterns[index] = { ...patterns[index], ...updates };
      await this.savePatterns(patterns);
    }
  }

  async addPattern(pattern: UrlPattern): Promise<void> {
    const patterns = await this.getPatterns();
    
    // Check if pattern already exists for this domain
    const existingIndex = patterns.findIndex(p => p.domain === pattern.domain);
    
    if (existingIndex >= 0) {
      // Update existing pattern with latest data, preserving success rate
      const existing = patterns[existingIndex];
      patterns[existingIndex] = {
        ...pattern,
        successRate: existing.successRate // Keep the learned success rate
      };
    } else {
      // Add new pattern
      patterns.push(pattern);
    }
    
    await this.savePatterns(patterns);
  }
}

// Global storage instance
export const patternStorage = new CachePatternStorage();

// Core prediction engine that orchestrates all the components
export class ChapterNavigationEngine {
  private storage: PatternStorage;
  private validator: typeof UrlValidator;
  private scraper: typeof NavigationScraper;
  private detector: typeof PatternDetector;
  private generator: typeof UrlGenerator;

  constructor(storage: PatternStorage = patternStorage) {
    this.storage = storage;
    this.validator = UrlValidator;
    this.scraper = NavigationScraper;
    this.detector = PatternDetector;
    this.generator = UrlGenerator;
  }

  async predictNavigation(url: string): Promise<{
    nextUrl: string | null;
    previousUrl: string | null;
    pattern: UrlPattern | null;
    confidence: number;
    method: 'pattern' | 'scraping';
    sourceUrl: string;
    validated: boolean;
  }> {
    const { identifier, type, pattern: detectedPattern } = extractChapterIdentifier(url);
    
    // Try pattern-based prediction if we can extract a chapter identifier
    if (identifier && type && detectedPattern) {
      const urlObj = new URL(url);
      const domainPattern = await this.storage.getPattern(urlObj.hostname);
      
      // If we have a stored pattern with good confidence, use it
      if (domainPattern && domainPattern.confidence > 0.6) {
        const nextUrl = this.generator.generateNextUrl(url, domainPattern);
        const prevUrl = this.generator.generatePrevUrl(url, domainPattern);
        
        // Validate the predicted URLs
        const [nextValid, prevValid] = await this.validator.validateUrls([nextUrl, prevUrl]);
        
        // Update pattern confidence based on validation results
        if (nextValid || prevValid) {
          const updatedPattern = {
            ...domainPattern,
            successRate: Math.min(0.95, domainPattern.successRate + 0.05), // Increase on success
            lastUsed: Date.now(),
            confidence: Math.min(0.95, domainPattern.successRate + 0.05)
          };
          await this.storage.updatePattern(urlObj.hostname, updatedPattern);
        }
        
        return {
          nextUrl: nextValid ? nextUrl : null,
          previousUrl: prevValid ? prevUrl : null,
          pattern: domainPattern,
          confidence: domainPattern.confidence,
          method: 'pattern',
          sourceUrl: url,
          validated: true
        };
      }
    }

    // Try to learn a new pattern from this URL
    const learnedPattern = this.detector.learnPattern(url);
    if (learnedPattern) {
      const nextUrl = this.generator.generateNextUrl(url, learnedPattern);
      const prevUrl = this.generator.generatePrevUrl(url, learnedPattern);
      
      const [nextValid, prevValid] = await this.validator.validateUrls([nextUrl, prevUrl]);
      
      // If validation succeeds, this pattern looks good - store it
      if (nextValid || prevValid) {
        learnedPattern.confidence = 0.7; // Good initial confidence since validation passed
        learnedPattern.successRate = 0.7;
        await this.storage.addPattern(learnedPattern);
        
        return {
          nextUrl: nextValid ? nextUrl : null,
          previousUrl: prevValid ? prevUrl : null,
          pattern: learnedPattern,
          confidence: learnedPattern.confidence,
          method: 'pattern',
          sourceUrl: url,
          validated: true
        };
      }
    }

    // Fall back to scraping if pattern prediction fails
    const scrapedLinks = await this.scraper.scrapeNavigationLinks(url);
    
    return {
      nextUrl: scrapedLinks.nextUrl,
      previousUrl: scrapedLinks.prevUrl,
      pattern: null,
      confidence: 0.3,
      method: 'scraping',
      sourceUrl: url,
      validated: true
    };
  }
}

// Global engine instance
export const navigationEngine = new ChapterNavigationEngine();
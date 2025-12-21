import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import NodeCache from 'node-cache';
import { URL } from 'url';

interface ScrapeResult {
  markdown: string;
  title: string;
  sourceUrl: string;
  error?: string;
}

interface SourcePattern {
  name: string;
  urlPattern: RegExp;
  selectors: {
    title: string[];
    content: string[];
    remove: string[];
  };
  waitForSelector?: string;
  waitTime?: number;
}

const requestCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

const sourcePatterns: SourcePattern[] = [
  {
    name: 'wuxiaworld',
    urlPattern: /wuxiaworld/i,
    selectors: {
      title: ['.caption h4', '.chapter-title', 'h1', 'h2'],
      content: [
        '.chapter-content',
        '.fr-view',
        '.chapter-content',
        'article',
        '.chapter-inner',
        '#chapter-content',
        '.content',
      ],
      remove: [
        '.adsbygoogle',
        '.adsense',
        '.advertisement',
        '.ad-container',
        '.chapter-nav',
        '.text-center',
        'iframe',
        'script',
        'ins',
        '.social-share',
        '.comments',
      ],
    },
    waitForSelector: '.chapter-content',
  },
  {
    name: 'webnovel',
    urlPattern: /webnovel|wuxiaworldsite/i,
    selectors: {
      title: ['.cha-titl', 'h1', '.chapter-title', '.title', 'h2'],
      content: [
        '.cha-words',
        '.chapter-content',
        '.content',
        '.chapter-words',
        '.font_ab',
        '.cha-content',
        '#j_content',
      ],
      remove: [
        '.adsbygoogle',
        '.adsense',
        '.advertisement',
        '.ad-container',
        '.support translators',
        'iframe',
        'script',
        'ins',
        '.g-users-w',
        '.cha-share',
        '.cha-score',
        '.announcement',
      ],
    },
    waitForSelector: '.cha-content',
  },
  {
    name: 'scrivare',
    urlPattern: /scrivare|wuxiaworld\.co/i,
    selectors: {
      title: ['h1', '.title', '.chapter-title'],
      content: [
        '.chapter-inner',
        '.text-left',
        '.reading-content',
        '.chapter-content',
        '.content',
        '.post-content',
      ],
      remove: [
        '.als',
        '.advertis',
        '.adsbygoogle',
        '.bannered',
        'iframe',
        'script',
        'ins',
        '.navigation',
        '.post-nav',
      ],
    },
    waitForSelector: '.reading-content',
  },
  {
    name: 'boxnovel',
    urlPattern: /boxnovel|novelfull/i,
    selectors: {
      title: ['h1', '.title', '.chr-title', '.chapter-title'],
      content: [
        '.text-left',
        '.cha-words',
        '.reading-content',
        '.chapter-content',
        '.chr-content',
        '.entry-content',
        '#chr-content',
      ],
      remove: [
        '.adsbygoogle',
        '.adsense',
        '.advertisement',
        '.ad-container',
        'iframe',
        'script',
        'ins',
        '.facebook',
        '.social-media',
        '.navigation',
        '#ad',
      ],
    },
    waitForSelector: '.text-left',
  },
  {
    name: 'readlightnovel',
    urlPattern: /readlightnovel/i,
    selectors: {
      title: ['.block-title', 'h1', '.title'],
      content: [
        '.desc',
        '.chapter-content',
        '.text-left',
        '.reader-content',
        '.content',
      ],
      remove: [
        '.adsbygoogle',
        '.adsense',
        '.advertisement',
        '.novel-row',
        'iframe',
        'script',
        'ins',
        '.adsbox',
        '.support',
      ],
    },
    waitForSelector: '.desc',
  },
  {
    name: 'generic',
    urlPattern: /.*/,
    selectors: {
      title: ['h1', 'title', '.title', 'h2'],
      content: [
        'article',
        '.content',
        '.chapter-content',
        '.reading-content',
        '.text-left',
        '.entry-content',
        '.post-content',
        '.novel-content',
        'main',
        '[role="main"]',
        '.main-content',
      ],
      remove: [
        '.adsbygoogle',
        '.adsense',
        '.advertisement',
        '.ad-container',
        'iframe',
        'script',
        'ins',
        '.nav',
        '.navigation',
        '.menu',
        '.sidebar',
        '.comment',
        '.comments',
        '.social',
        '.share',
        'header',
        'footer',
        '.header',
        '.footer',
        '.banner',
        '.announcement',
      ],
    },
    waitTime: 2000,
  },
];

export class UniversalScraper {
  private turndownService: TurndownService;

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
    });

    this.turndownService.addRule('preserveLineBreaks', {
      filter: 'p',
      replacement: (content: string) => {
        return '\n\n' + content + '\n\n';
      },
    });

    this.turndownService.addRule('removeEmptyParagraphs', {
      filter: (node: any) => {
        return (
          node.nodeName === 'P' &&
          node.textContent?.trim().length === 0
        );
      },
      replacement: () => '',
    });
  }

  private getSourcePattern(url: string): SourcePattern {
    const pattern =
      sourcePatterns.find((p) => p.urlPattern.test(url)) ||
      sourcePatterns[sourcePatterns.length - 1];
    return pattern;
  }

  private cleanContent($: cheerio.CheerioAPI, content: any): string {
    const contentClone = $(content).clone();

    const baseUri = ($.root().attr() as any)?.baseURI || '';
    this.getSourcePattern(baseUri).selectors.remove.forEach(
      (selector) => {
        contentClone.find(selector).remove();
      }
    );

    contentClone.find('*').each((_, elem) => {
      const el = $(elem);
      const style = el.attr('style') || '';
      const className = el.attr('class') || '';

      if (
        style.includes('display:none') ||
        style.includes('visibility:hidden') ||
        className.includes('ads') ||
        className.includes('banner') ||
        className.includes('advert')
      ) {
        el.remove();
      }
    });

    return contentClone.html() || '';
  }

  private validateContent(html: string): boolean {
    if (!html || html.length < 500) return false;

    const htmlRatio = (html.match(/<[^>]*>/g) || []).length / (html.length || 1);
    if (htmlRatio > 0.3) return false;

    const textOnly = html.replace(/<[^>]*>/g, ' ');
    if (textOnly.trim().length < 300) return false;

    const adKeywords = [
      'advertisement',
      'adsbygoogle',
      'sponsored',
      'banner',
      'subscribe',
      'newsletter',
      'support us',
      'patreon',
      'paypal',
    ];

    const hasTooManyAds =
      adKeywords.filter((keyword) => textOnly.toLowerCase().includes(keyword.toLowerCase()))
        .length > 3;

    if (hasTooManyAds) return false;

    return true;
  }

  async scrapeWithPuppeteer(
    url: string,
    sourcePattern: SourcePattern
  ): Promise<{ title: string; content: string }> {
    const browser = await puppeteer.launch({
      headless: 'new' as any,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    });

    try {
      const page = await browser.newPage();

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
          request.abort();
        } else {
          request.continue();
        }
      });

      let response: any;
      try {
        response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      } catch (error) {
        console.warn('Navigation timeout, continuing with partial load');
      }

      if (sourcePattern.waitForSelector) {
        try {
          await page.waitForSelector(sourcePattern.waitForSelector, {
            timeout: 10000,
          });
        } catch (error) {
          console.warn(`Selector ${sourcePattern.waitForSelector} not found`);
        }
      }

      if (sourcePattern.waitTime) {
        await new Promise(resolve => setTimeout(resolve, sourcePattern.waitTime));
      }

      const html = await page.content();
      const $ = cheerio.load(html);

      let title = '';
      for (const selector of sourcePattern.selectors.title) {
        const titleElement = $(selector).first();
        if (titleElement.length > 0) {
          title = titleElement.text().trim();
          break;
        }
      }

      let content = null;
      for (const selector of sourcePattern.selectors.content) {
        const contentElement = $(selector).first();
        if (contentElement.length > 0) {
          content = contentElement[0];
          break;
        }
      }

      if (!content) {
        const body = $('body')[0];
        if (!body) {
          throw new Error('Could not find any content');
        }
        content = body;
      }

      const cleanedHtml = this.cleanContent($, content);

      return {
        title: title || 'Untitled Chapter',
        content: cleanedHtml,
      };
    } finally {
      await browser.close();
    }
  }

  async scrapeWithCheerio(
    url: string,
    sourcePattern: SourcePattern
  ): Promise<{ title: string; content: string }> {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    let title = '';
    for (const selector of sourcePattern.selectors.title) {
      const titleElement = $(selector).first();
      if (titleElement.length > 0) {
        title = titleElement.text().trim();
        break;
      }
    }

    let content = null;
    for (const selector of sourcePattern.selectors.content) {
      const contentElement = $(selector).first();
      if (contentElement.length > 0) {
        content = contentElement[0];
        break;
      }
    }

    if (!content) {
      const body = $('body')[0];
      if (!body) {
        throw new Error('Could not find any content');
      }
      content = body;
    }

    const cleanedHtml = this.cleanContent($, content);

    return {
      title: title || 'Untitled Chapter',
      content: cleanedHtml,
    };
  }

  async scrapeWithFallback(
    url: string
  ): Promise<{ title: string; content: string; usedPuppeteer: boolean }> {
    try {
      const sourcePattern = this.getSourcePattern(url);
      const result = await this.scrapeWithCheerio(url, sourcePattern);
      if (!this.validateContent(result.content)) {
        throw new Error('Content validation failed for static scraping');
      }
      return { ...result, usedPuppeteer: false };
    } catch (error) {
      console.log('Cheerio scraping failed, falling back to Puppeteer:', error);
      const sourcePattern = this.getSourcePattern(url);
      const result = await this.scrapeWithPuppeteer(url, sourcePattern);
      if (!this.validateContent(result.content)) {
        throw new Error('Content validation failed even with Puppeteer');
      }
      return { ...result, usedPuppeteer: true };
    }
  }

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const cacheKey = `scrape:${url}`;
      const cached = requestCache.get<ScrapeResult>(cacheKey);

      if (cached) {
        return cached;
      }

      const { title, content, usedPuppeteer } = await this.scrapeWithFallback(url);

      const markdown = this.turndownService.turndown(content);

      const result: ScrapeResult = {
        markdown,
        title,
        sourceUrl: url,
      };

      requestCache.set(cacheKey, result);

      console.log(`Successfully scraped ${url} using ${usedPuppeteer ? 'Puppeteer' : 'Cheerio'}`);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        markdown: '',
        title: '',
        sourceUrl: url,
        error: errorMessage,
      };
    }
  }
}

export const scraper = new UniversalScraper();
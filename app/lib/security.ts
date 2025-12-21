import { NextRequest } from 'next/server';

// URL validation patterns
const ALLOWED_DOMAINS = [
  'r.jina.ai',
  'r.jina.cn',
  'r.jina.co',
  'api.allorigins.win',
  'r.jina.im'
];

const CHAPTER_URL_PATTERNS = [
  /^(https?:\/\/r\.jina\.ai\/https?:\/\/[^\/]+\/[^\/]+\/\d+\/?$)/,
  /^(https?:\/\/api\.allorigins\.win\/get\?url=https?%3A%2F%2F[^\/]+%2F[^\/]+%2F\d+%2F$)/,
  /^(https?:\/\/r\.jina\.ai\/https?:\/\/[^\/]+\/[^\/]+\/\d+\/\d+\/?$)/
];

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedUrl?: string;
}

export interface RequestValidation {
  isValid: boolean;
  errors: string[];
  sanitized?: {
    url?: string;
    text?: string;
    sourceUrl?: string;
    chapterNumber?: string;
  };
}

/**
 * Extract client IP from request headers
 */
export function getClientIP(request: NextRequest): string {
  // Try various headers that might contain the real IP
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  const remoteAddr = request.headers.get('remote-addr');
  if (remoteAddr) {
    return remoteAddr;
  }

  // Fallback to a default IP for development
  return '127.0.0.1';
}

/**
 * Validate and sanitize URL to prevent SSRF attacks
 */
export function validateAndSanitizeUrl(url: string): ValidationResult {
  try {
    // Basic URL parsing
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        isValid: false,
        error: 'Invalid URL format'
      };
    }

    // Only allow HTTP and HTTPS
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return {
        isValid: false,
        error: 'Only HTTP and HTTPS protocols are allowed'
      };
    }

    // Check if domain is in allowlist
    const hostname = parsedUrl.hostname.toLowerCase();
    const isAllowedDomain = ALLOWED_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith(`.${domain}`)
    );

    if (!isAllowedDomain) {
      return {
        isValid: false,
        error: `Domain not allowed: ${hostname}. Only trusted domains are permitted.`
      };
    }

    // Remove any suspicious characters or patterns
    const sanitizedUrl = url
      .replace(/[<>\"']/g, '') // Remove potentially dangerous characters
      .replace(/\.\./g, '') // Remove path traversal attempts
      .trim();

    // Final validation of sanitized URL
    try {
      new URL(sanitizedUrl);
    } catch {
      return {
        isValid: false,
        error: 'URL became invalid after sanitization'
      };
    }

    return {
      isValid: true,
      sanitizedUrl
    };

  } catch (error) {
    return {
      isValid: false,
      error: 'URL validation failed'
    };
  }
}

/**
 * Validate chapter URL pattern
 */
export function validateChapterUrl(url: string): ValidationResult {
  const isValidPattern = CHAPTER_URL_PATTERNS.some(pattern => pattern.test(url));
  
  if (!isValidPattern) {
    return {
      isValid: false,
      error: 'URL does not match expected chapter pattern'
    };
  }

  return {
    isValid: true
  };
}

/**
 * Extract chapter number from URL
 */
export function extractChapterNumber(url: string): string | null {
  const matches = url.match(/\/(\d+)(?:\/|$)/);
  return matches ? matches[1] : null;
}

/**
 * Validate request text content
 */
export function validateTextContent(text: string): ValidationResult {
  if (!text || typeof text !== 'string') {
    return {
      isValid: false,
      error: 'Text content is required and must be a string'
    };
  }

  if (text.trim().length === 0) {
    return {
      isValid: false,
      error: 'Text content cannot be empty'
    };
  }

  if (text.length > 1 * 1024 * 1024) { // 1MB limit
    return {
      isValid: false,
      error: 'Text content exceeds 1MB size limit'
    };
  }

  return {
    isValid: true
  };
}

/**
 * Validate source URL for scraping
 */
export function validateSourceUrl(url: string): ValidationResult {
  const urlValidation = validateAndSanitizeUrl(url);
  if (!urlValidation.isValid) {
    return urlValidation;
  }

  // Additional checks for source URLs
  if (!urlValidation.sanitizedUrl) {
    return {
      isValid: false,
      error: 'URL validation failed'
    };
  }

  // For source URLs, we might have different patterns
  // This is where you'd add novel site specific validation
  const sourceUrlPatterns = [
    /^(https?:\/\/)[^\/]+\/[^\/]+\/\d+\/?$/,
    /^(https?:\/\/)[^\/]+\/[^\/]+\/\d+\/\d+\/?$/
  ];

  const isValidSourcePattern = sourceUrlPatterns.some(pattern => 
    pattern.test(urlValidation.sanitizedUrl)
  );

  if (!isValidSourcePattern) {
    return {
      isValid: false,
      error: 'Source URL does not match expected novel chapter pattern'
    };
  }

  return urlValidation;
}

/**
 * Comprehensive request validation
 */
export function validateRequest(
  requestData: any,
  type: 'translate' | 'scrape'
): RequestValidation {
  const errors: string[] = [];

  if (!requestData || typeof requestData !== 'object') {
    return {
      isValid: false,
      errors: ['Request body must be a valid JSON object']
    };
  }

  let sanitized: RequestValidation['sanitized'] = {};

  if (type === 'translate') {
    const { text, sourceUrl, chapterNumber } = requestData;

    // Validate text content
    const textValidation = validateTextContent(text);
    if (!textValidation.isValid) {
      errors.push(`Text: ${textValidation.error}`);
    } else {
      sanitized.text = text;
    }

    // Validate source URL
    if (sourceUrl) {
      const urlValidation = validateSourceUrl(sourceUrl);
      if (!urlValidation.isValid) {
        errors.push(`Source URL: ${urlValidation.error}`);
      } else {
        sanitized.sourceUrl = urlValidation.sanitizedUrl || sourceUrl;
      }
    }

    // Extract and validate chapter number
    if (sourceUrl) {
      const extractedChapter = extractChapterNumber(sourceUrl);
      if (!extractedChapter) {
        errors.push('Could not extract chapter number from source URL');
      } else {
        sanitized.chapterNumber = extractedChapter;
      }
    }

  } else if (type === 'scrape') {
    const { url } = requestData;

    // Validate URL
    const urlValidation = validateSourceUrl(url);
    if (!urlValidation.isValid) {
      errors.push(`URL: ${urlValidation.error}`);
    } else {
      sanitized.url = urlValidation.sanitizedUrl || url;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? sanitized : undefined
  };
}

/**
 * Log security events for monitoring
 */
export function logSecurityEvent(
  event: string,
  details: {
    ip?: string;
    userAgent?: string;
    url?: string;
    reason?: string;
    timestamp?: number;
  }
): void {
  const logEntry = {
    event,
    timestamp: Date.now(),
    ip: details.ip || 'unknown',
    userAgent: details.userAgent || 'unknown',
    url: details.url,
    reason: details.reason,
    level: 'security'
  };

  console.log(`[SECURITY] ${JSON.stringify(logEntry)}`);
}

/**
 * Check if request appears to be from a bot
 */
export function isBotRequest(userAgent: string | null): boolean {
  if (!userAgent) return true;

  const botPatterns = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
    /curl/i,
    /wget/i,
    /python/i,
    /node/i,
    /go-http-client/i,
    /postman/i
  ];

  return botPatterns.some(pattern => pattern.test(userAgent));
}
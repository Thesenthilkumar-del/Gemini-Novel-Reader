import { NextRequest, NextResponse } from 'next/server';
import { navigationEngine } from '../../lib/pattern-storage';
import { cache } from '../../lib/cache';
import { checkRateLimit } from '../../lib/rate-limiter';
import { validateRequest, getClientIP, logSecurityEvent } from '../../lib/security';

// Response interfaces
interface NextChapterSuccessResponse {
  nextUrl: string | null;
  previousUrl: string | null;
  pattern: {
    domain: string;
    pattern: string;
    chapterIdentifier: 'numeric' | 'alphanumeric';
    confidence: number;
    successRate: number;
    lastUsed: number;
  } | null;
  confidence: number;
  method: 'pattern' | 'scraping';
  sourceUrl: string;
  validated: boolean;
  responseTime: number;
  cached: boolean;
}

interface NextChapterErrorResponse {
  error: string;
  message: string;
  requestId?: string;
  responseTime?: string;
  details?: string[];
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIP(request);
  const userAgent = request.headers.get('user-agent') || undefined;

  logSecurityEvent('NEXT_CHAPTER_REQUEST_START', {
    ip,
    userAgent,
    url: request.url
  });

  try {
    // Rate limiting check
    const rateLimitResult = checkRateLimit(ip, '/api/next-chapter');
    if (!rateLimitResult.success) {
      logSecurityEvent('NEXT_CHAPTER_RATE_LIMIT_EXCEEDED', {
        ip,
        userAgent,
        url: request.url,
        reason: 'Rate limit exceeded at API level'
      });

      const response = NextResponse.json(
        { 
          error: 'Rate limit exceeded',
          message: 'Too many navigation requests. Please try again later.',
          retryAfter: rateLimitResult.retryAfter || 60
        } as NextChapterErrorResponse,
        { status: 429 }
      );

      if (rateLimitResult.retryAfter) {
        response.headers.set('Retry-After', rateLimitResult.retryAfter.toString());
      }

      return response;
    }

    // Parse and validate request
    let requestData;
    try {
      requestData = await request.json();
    } catch (error) {
      logSecurityEvent('NEXT_CHAPTER_INVALID_JSON', {
        ip,
        userAgent,
        url: request.url,
        reason: 'Invalid JSON in request body'
      });

      return NextResponse.json(
        { 
          error: 'Invalid JSON in request body',
          message: 'The request body must be valid JSON'
        } as NextChapterErrorResponse,
        { status: 400 }
      );
    }

    // Validate request input
    const validation = validateRequest(requestData, 'nextChapter');
    if (!validation.isValid) {
      logSecurityEvent('NEXT_CHAPTER_VALIDATION_FAILED', {
        ip,
        userAgent,
        url: request.url,
        reason: `Validation errors: ${validation.errors.join(', ')}`
      });

      return NextResponse.json(
        { 
          error: 'Request validation failed',
          message: 'The request parameters are invalid',
          details: validation.errors 
        } as NextChapterErrorResponse,
        { status: 400 }
      );
    }

    const { url } = validation.sanitized!;
    
    // Additional runtime check for safety
    if (!url) {
      return NextResponse.json(
        { 
          error: 'Invalid request',
          message: 'URL is required'
        } as NextChapterErrorResponse,
        { status: 400 }
      );
    }

    // Check cache first
    const cacheKey = `chapter-nav:${Buffer.from(url).toString('base64')}`;
    const cached = await cache.getScrape(cacheKey);
    if (cached) {
      const navData = JSON.parse(cached.content);
      const cachedResponse = {
        ...navData,
        cached: true,
        responseTime: Date.now() - startTime
      } as NextChapterSuccessResponse;
      
      const response = NextResponse.json(cachedResponse);
      
      response.headers.set('X-Cache-Hit', 'true');
      response.headers.set('X-Response-Time', `${Date.now() - startTime}ms`);
      
      logSecurityEvent('NEXT_CHAPTER_CACHE_HIT', {
        ip,
        userAgent,
        url: request.url
      });

      return response;
    }

    // Perform prediction using the navigation engine
    const prediction = await navigationEngine.predictNavigation(url);

    // Cache the result (24 hour TTL)
    const cacheData = {
      nextUrl: prediction.nextUrl,
      previousUrl: prediction.previousUrl,
      pattern: prediction.pattern,
      confidence: prediction.confidence,
      method: prediction.method,
      validated: prediction.validated,
      sourceUrl: prediction.sourceUrl
    };
    
    await cache.setScrape(cacheKey, JSON.stringify(cacheData), 24 * 60 * 60 * 1000);

    const responseTime = Date.now() - startTime;
    const successResponse = {
      ...cacheData,
      responseTime,
      cached: false
    } as NextChapterSuccessResponse;
    
    const response = NextResponse.json(successResponse);
    
    response.headers.set('X-Cache-Hit', 'false');
    response.headers.set('X-Response-Time', `${responseTime}ms`);
    response.headers.set('X-Method-Used', prediction.method);
    response.headers.set('X-Confidence', prediction.confidence.toString());
    
    logSecurityEvent('NEXT_CHAPTER_SUCCESS', {
      ip,
      userAgent,
      url: request.url,
      reason: `Response time: ${responseTime}ms, Method: ${prediction.method}, Confidence: ${prediction.confidence}, Next URL: ${prediction.nextUrl || 'none'}, Previous URL: ${prediction.previousUrl || 'none'}`
    });

    return response;

  } catch (error: any) {
    console.error('Next Chapter Prediction Error:', error);
    
    logSecurityEvent('NEXT_CHAPTER_ERROR', {
      ip,
      userAgent,
      url: request.url,
      reason: `Prediction failed: ${error.message}`
    });

    const responseTime = Date.now() - startTime;
    
    const errorResponse: NextChapterErrorResponse = { 
      error: 'Navigation prediction failed',
      message: 'Unable to predict next/previous chapter URLs',
      requestId: Date.now().toString(),
      responseTime: `${responseTime}ms`
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// GET endpoint to retrieve pattern statistics
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIP(request);
  
  logSecurityEvent('NEXT_CHAPTER_STATS_REQUEST', { ip });

  try {
    // Simple rate limiting for GET requests
    const rateLimitResult = checkRateLimit(ip, '/api/next-chapter');
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    const patterns = await navigationEngine['storage'].getPatterns();
    const stats = {
      totalPatterns: patterns.length,
      patternsByConfidence: {
        high: patterns.filter(p => p.confidence >= 0.8).length,
        medium: patterns.filter(p => p.confidence >= 0.5 && p.confidence < 0.8).length,
        low: patterns.filter(p => p.confidence < 0.5).length
      },
      responseTime: Date.now() - startTime
    };

    const response = NextResponse.json(stats);
    response.headers.set('X-Response-Time', `${Date.now() - startTime}ms`);
    
    return response;

  } catch (error) {
    console.error('Stats endpoint error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve statistics' },
      { status: 500 }
    );
  }
}
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '../../lib/rate-limiter';
import { cache, cacheHelpers } from '../../lib/cache';
import { 
  validateRequest, 
  getClientIP, 
  logSecurityEvent
} from '../../lib/security';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIP(request);
  const userAgent = request.headers.get('user-agent') || undefined;
  
  // Log the request
  logSecurityEvent('SCRAPE_REQUEST_START', {
    ip,
    userAgent,
    url: request.url
  });

  try {
    // Rate limiting check
    const rateLimitResult = checkRateLimit(ip, '/api/scrape');
    if (!rateLimitResult || !rateLimitResult.success) {
      logSecurityEvent('SCRAPE_RATE_LIMIT_EXCEEDED', {
        ip,
        userAgent,
        url: request.url,
        reason: 'Rate limit exceeded at API level'
      });

      const response = NextResponse.json(
        { 
          error: 'Rate limit exceeded',
          message: 'Too many scrape requests. Please try again later.',
          retryAfter: rateLimitResult.retryAfter
        },
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
      logSecurityEvent('SCRAPE_INVALID_JSON', {
        ip,
        userAgent,
        url: request.url,
        reason: 'Invalid JSON in request body'
      });

      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Validate request input
    const validation = validateRequest(requestData, 'scrape');
    if (!validation.isValid) {
      logSecurityEvent('SCRAPE_VALIDATION_FAILED', {
        ip,
        userAgent,
        url: request.url,
        reason: `Validation errors: ${validation.errors.join(', ')}`
      });

      return NextResponse.json(
        { 
          error: 'Request validation failed',
          details: validation.errors 
        },
        { status: 400 }
      );
    }

    const { url } = validation.sanitized!;

    // Check cache first
    const cachedScrape = await cache.getScrape(url);
    if (cachedScrape) {
      const response = NextResponse.json({ 
        content: cachedScrape.content,
        sourceUrl: cachedScrape.sourceUrl,
        cached: true,
        timestamp: cachedScrape.timestamp
      });
      
      response.headers.set('X-Cache-Hit', 'true');
      response.headers.set('X-Response-Time', `${Date.now() - startTime}ms`);
      
      logSecurityEvent('SCRAPE_CACHE_HIT', {
        ip,
        userAgent,
        url: request.url
      });

      return response;
    }

    // Timeout wrapper for scraping
    const timeout = (promise: Promise<any>, ms: number) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Scrape request timeout after 60 seconds')), ms)
        )
      ]);
    };

    try {
      // Scrape the content using r.jina.ai (which is what the client uses)
      const scrapeUrl = `https://r.jina.ai/${url}`;
      
      logSecurityEvent('SCRAPE_START', {
        ip,
        userAgent,
        url: request.url,
        reason: `Scraping: ${scrapeUrl}`
      });

      const response = await timeout(
        fetch(scrapeUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Gemini Novel Reader/1.0',
            'Accept': 'text/plain, text/markdown, text/html;q=0.9, */*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          },
          // Prevent following redirects to avoid SSRF
          redirect: 'follow'
        }), 
        60000
      ) as Response;

      if (!response.ok) {
        logSecurityEvent('SCRAPE_HTTP_ERROR', {
          ip,
          userAgent,
          url: request.url,
          reason: `HTTP error ${response.status}: ${response.statusText}`
        });

        return NextResponse.json(
          { 
            error: 'Failed to scrape content',
            message: `Remote server returned ${response.status}: ${response.statusText}`,
            status: response.status
          },
          { status: 502 }
        );
      }

      const content = await response.text();
      
      // Validate content size
      if (!cacheHelpers.isValidContentSize(content)) {
        logSecurityEvent('SCRAPE_CONTENT_TOO_LARGE', {
          ip,
          userAgent,
          url: request.url,
          reason: `Content size: ${cacheHelpers.getContentSize(content)} bytes`
        });

        return NextResponse.json(
          { 
            error: 'Scraped content exceeds 1MB limit',
            maxSize: '1MB',
            contentSize: cacheHelpers.getContentSize(content)
          },
          { status: 413 }
        );
      }

      // Basic content validation
      if (!content || content.trim().length === 0) {
        logSecurityEvent('SCRAPE_EMPTY_CONTENT', {
          ip,
          userAgent,
          url: request.url,
          reason: 'Scraped content is empty'
        });

        return NextResponse.json(
          { error: 'No content available from source' },
          { status: 404 }
        );
      }

      // Cache the successful scrape
      await cache.setScrape(url, content);

      const responseTime = Date.now() - startTime;
      const result = NextResponse.json({ 
        content,
        sourceUrl: url,
        cached: false,
        responseTime
      });

      result.headers.set('X-Cache-Hit', 'false');
      result.headers.set('X-Response-Time', `${responseTime}ms`);
      result.headers.set('X-Content-Size', cacheHelpers.getContentSize(content).toString());

      logSecurityEvent('SCRAPE_SUCCESS', {
        ip,
        userAgent,
        url: request.url,
        reason: `Content size: ${content.length} chars, Response time: ${responseTime}ms`
      });

      return result;

    } catch (fetchError: any) {
      // Handle timeout errors specifically
      if (fetchError.message?.includes('timeout') || fetchError.message?.includes('timed out')) {
        logSecurityEvent('SCRAPE_TIMEOUT', {
          ip,
          userAgent,
          url: request.url,
          reason: `Scrape request timed out: ${fetchError.message}`
        });

        return NextResponse.json(
          { 
            error: 'Scrape request timed out',
            message: 'The scraping service is taking too long to respond. Please try again later.',
            retryAfter: 30
          },
          { status: 504 }
        );
      }

      // Handle network errors
      logSecurityEvent('SCRAPE_NETWORK_ERROR', {
        ip,
        userAgent,
        url: request.url,
        reason: `Network error during scraping: ${fetchError.message}`
      });

      return NextResponse.json(
        { 
          error: 'Failed to scrape content',
          message: 'Network error occurred while fetching content from source.',
          details: fetchError.message
        },
        { status: 502 }
      );
    }

  } catch (error: any) {
    console.error('Scrape Error:', error);
    
    // Log the final error
    logSecurityEvent('SCRAPE_FINAL_ERROR', {
      ip,
      userAgent,
      url: request.url,
      reason: `Unhandled scrape error: ${error.message}`
    });

    const responseTime = Date.now() - startTime;
    
    // Return appropriate error response
    const errorResponse = { 
      error: 'Internal scraping error',
      message: 'An unexpected error occurred during content scraping.',
      requestId: Date.now().toString(),
      responseTime: `${responseTime}ms`
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // Allow checking scrape status or cache info
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'stats') {
    const stats = await cache.getStats();
    return NextResponse.json({
      message: 'Cache statistics',
      stats,
      timestamp: Date.now()
    });
  }

  return NextResponse.json({
    error: 'Method not allowed',
    message: 'Use POST to scrape content, or GET with ?action=stats for cache stats'
  }, { status: 405 });
}
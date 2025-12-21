import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '../../lib/rate-limiter';
import { cache, cacheHelpers } from '../../lib/cache';
import { 
  validateRequest, 
  getClientIP, 
  logSecurityEvent,
  isBotRequest 
} from '../../lib/security';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIP(request);
  const userAgent = request.headers.get('user-agent') || undefined;
  
  // Log the request
  logSecurityEvent('TRANSLATE_REQUEST_START', {
    ip,
    userAgent,
    url: request.url
  });
  try {
    // Rate limiting check (should be done in middleware, but double-check here)
    const rateLimitResult = checkRateLimit(ip, '/api/translate');
    if (!rateLimitResult.success) {
      logSecurityEvent('TRANSLATE_RATE_LIMIT_EXCEEDED', {
        ip,
        userAgent,
        url: request.url,
        reason: 'Rate limit exceeded at API level'
      });

      const response = NextResponse.json(
        { 
          error: 'Rate limit exceeded',
          message: 'Too many translation requests. Please try again later.',
          retryAfter: rateLimitResult.retryAfter || 60
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
      logSecurityEvent('TRANSLATE_INVALID_JSON', {
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
    const validation = validateRequest(requestData, 'translate');
    if (!validation.isValid) {
      logSecurityEvent('TRANSLATE_VALIDATION_FAILED', {
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

    const { text, sourceUrl, chapterNumber } = validation.sanitized!;

    // Check content size
    if (!cacheHelpers.isValidContentSize(text!)) {
      logSecurityEvent('TRANSLATE_CONTENT_TOO_LARGE', {
        ip,
        userAgent,
        url: request.url,
        reason: `Content size: ${cacheHelpers.getContentSize(text!)} bytes`
      });

      return NextResponse.json(
        { 
          error: 'Content size exceeds 1MB limit',
          maxSize: '1MB'
        },
        { status: 413 }
      );
    }

    // Check cache first
    const cachedTranslation = await cache.getTranslation(sourceUrl!, chapterNumber!, text!);
    if (cachedTranslation) {
      const response = NextResponse.json({ 
        translation: cachedTranslation.translatedText,
        cached: true,
        model: cachedTranslation.model,
        timestamp: cachedTranslation.timestamp
      });
      
      response.headers.set('X-Cache-Hit', 'true');
      response.headers.set('X-Response-Time', `${Date.now() - startTime}ms`);
      
      logSecurityEvent('TRANSLATE_CACHE_HIT', {
        ip,
        userAgent,
        url: request.url
      });

      return response;
    }

    if (!process.env.GEMINI_API_KEY) {
      logSecurityEvent('TRANSLATE_API_KEY_MISSING', {
        ip,
        userAgent,
        url: request.url
      });

      return NextResponse.json(
        { error: 'Translation service is not configured' },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const systemInstruction = "You are a professional translator. Detect proper names (e.g., 'Jiang Chen') and keep them capitalized. Do not translate names literally.";

    // Primary: Use Gemini 2.5 Pro (December 2025 stable model)
    let model;
    let useFallback = false;
    let modelName = 'gemini-2.5-pro';

    try {
      model = genAI.getGenerativeModel({
        model: 'gemini-2.5-pro',
        systemInstruction
      });
    } catch (error: any) {
      console.log('gemini-2.5-pro not available, using gemini-2.5-flash');
      useFallback = true;
      modelName = 'gemini-2.5-flash';
      model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction
      });
    }

    // Timeout wrapper for API calls
    const timeout = (promise: Promise<any>, ms: number) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout after 60 seconds')), ms)
        )
      ]);
    };

    try {
      const result = await timeout(model.generateContent(text!), 60000) as any;
      
      // Validate response structure before accessing text()
      if (!result || !result.response) {
        logSecurityEvent('TRANSLATE_INVALID_RESPONSE', {
          ip,
          userAgent,
          url: request.url,
          reason: `Invalid API response structure: hasResult=${!!result}, hasResponse=${!!(result?.response)}`
        });

        return NextResponse.json(
          { error: 'Translation service returned invalid response structure' },
          { status: 502 }
        );
      }

      // Extract translation with validation
      let translation: string | undefined;
      try {
        translation = result.response.text();
      } catch (textError: any) {
        logSecurityEvent('TRANSLATE_TEXT_EXTRACTION_FAILED', {
          ip,
          userAgent,
          url: request.url,
          reason: `Failed to extract text from response: ${textError.message}`
        });

        return NextResponse.json(
          { error: 'Failed to extract translation from API response' },
          { status: 502 }
        );
      }

      // Validate that translation exists and is a non-empty string
      if (!translation || typeof translation !== 'string' || translation.trim().length === 0) {
        logSecurityEvent('TRANSLATE_EMPTY_RESPONSE', {
          ip,
          userAgent,
          url: request.url,
          reason: `Empty or invalid translation: type=${typeof translation}, length=${translation?.length}`
        });

        return NextResponse.json(
          { error: 'Translation service returned empty or invalid response' },
          { status: 502 }
        );
      }

      // Cache the successful translation
      await cache.setTranslation(sourceUrl!, chapterNumber!, text!, translation, modelName);

      const responseTime = Date.now() - startTime;
      const response = NextResponse.json({ 
        translation,
        cached: false,
        model: modelName,
        responseTime
      });

      response.headers.set('X-Cache-Hit', 'false');
      response.headers.set('X-Response-Time', `${responseTime}ms`);
      response.headers.set('X-Model-Used', modelName);

      logSecurityEvent('TRANSLATE_SUCCESS', {
        ip,
        userAgent,
        url: request.url,
        reason: `Response time: ${responseTime}ms, Model: ${modelName}`
      });

      return response;
    } catch (error: any) {
      // If primary model fails and we haven't tried fallback, try fallback
      if (!useFallback && (error?.message?.includes('404') || error?.message?.includes('not found') || error?.status === 404)) {
        logSecurityEvent('TRANSLATE_MODEL_FALLBACK', {
          ip,
          userAgent,
          url: request.url,
          reason: `Primary model failed: ${error.message}`
        });

        console.log('gemini-2.5-pro failed, trying gemini-2.5-flash');
        modelName = 'gemini-2.5-flash';
        model = genAI.getGenerativeModel({
          model: 'gemini-2.5-flash',
          systemInstruction
        });
        
        try {
          const result = await timeout(model.generateContent(text!), 60000) as any;
          
          // Validate response structure before accessing text()
          if (!result || !result.response) {
            logSecurityEvent('TRANSLATE_FALLBACK_INVALID_RESPONSE', {
              ip,
              userAgent,
              url: request.url,
              reason: `Invalid fallback API response structure: hasResult=${!!result}, hasResponse=${!!(result?.response)}`
            });

            return NextResponse.json(
              { error: 'Translation service (fallback) returned invalid response structure' },
              { status: 502 }
            );
          }

          // Extract translation with validation
          let translation: string | undefined;
          try {
            translation = result.response.text();
          } catch (textError: any) {
            logSecurityEvent('TRANSLATE_FALLBACK_TEXT_EXTRACTION_FAILED', {
              ip,
              userAgent,
              url: request.url,
              reason: `Failed to extract text from fallback response: ${textError.message}`
            });

            return NextResponse.json(
              { error: 'Failed to extract translation from fallback API response' },
              { status: 502 }
            );
          }
          
          if (!translation || typeof translation !== 'string' || translation.trim().length === 0) {
            logSecurityEvent('TRANSLATE_FALLBACK_EMPTY_RESPONSE', {
              ip,
              userAgent,
              url: request.url,
              reason: `Empty or invalid translation from fallback: type=${typeof translation}, length=${translation?.length}`
            });

            return NextResponse.json(
              { error: 'Translation service (fallback) returned empty or invalid response' },
              { status: 502 }
            );
          }

          // Cache the successful translation
          await cache.setTranslation(sourceUrl!, chapterNumber!, text!, translation, modelName);

          const responseTime = Date.now() - startTime;
          const response = NextResponse.json({ 
            translation,
            cached: false,
            model: modelName,
            responseTime,
            fallback: true
          });

          response.headers.set('X-Cache-Hit', 'false');
          response.headers.set('X-Response-Time', `${responseTime}ms`);
          response.headers.set('X-Model-Used', modelName);
          response.headers.set('X-Fallback-Used', 'true');

          logSecurityEvent('TRANSLATE_FALLBACK_SUCCESS', {
            ip,
            userAgent,
            url: request.url,
            reason: `Response time: ${responseTime}ms, Model: ${modelName}`
          });

          return response;
        } catch (fallbackError: any) {
          logSecurityEvent('TRANSLATE_FALLBACK_FAILED', {
            ip,
            userAgent,
            url: request.url,
            reason: `Fallback model also failed: ${fallbackError.message}`
          });
        }
      }

      // Handle timeout errors specifically
      if (error.message?.includes('timeout') || error.message?.includes('timed out')) {
        logSecurityEvent('TRANSLATE_TIMEOUT', {
          ip,
          userAgent,
          url: request.url,
          reason: `Translation request timed out: ${error.message}`
        });

        return NextResponse.json(
          { 
            error: 'Translation request timed out',
            message: 'The translation service is taking too long to respond. Please try again later.',
            retryAfter: 30
          },
          { status: 504 }
        );
      }

      // Log the error and return generic error response
      logSecurityEvent('TRANSLATE_ERROR', {
        ip,
        userAgent,
        url: request.url,
        reason: `Translation failed: ${error.message}`
      });

      throw error;
    }

  } catch (error: any) {
    console.error('Translation Error:', error);
    
    // Log the final error
    logSecurityEvent('TRANSLATE_FINAL_ERROR', {
      ip,
      userAgent,
      url: request.url,
      reason: `Unhandled translation error: ${error.message}`
    });

    const responseTime = Date.now() - startTime;
    
    // Return appropriate error response
    const errorResponse = { 
      error: 'Internal translation error',
      message: 'An unexpected error occurred during translation.',
      requestId: Date.now().toString(),
      responseTime: `${responseTime}ms`
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}

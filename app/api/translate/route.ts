import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '../../lib/rate-limiter';
import { translationCache } from '../../lib/translation-cache';
import { isEnglish } from '../../lib/validation';
import { translateWithGoogle } from '../../lib/google-translate';
import { cacheHelpers } from '../../lib/cache';
import { 
  validateRequest, 
  getClientIP, 
  logSecurityEvent,
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
    // Rate limiting check
    const rateLimitResult = checkRateLimit(ip, '/api/translate');
    if (!rateLimitResult.success) {
      logSecurityEvent('TRANSLATE_RATE_LIMIT_EXCEEDED', {
        ip,
        userAgent,
        url: request.url,
        reason: 'Rate limit exceeded at API level'
      });

      // Try fallback to Google Translate on rate limit? 
      // Ticket says: "Implement rate limiting fallback to Google Translate API"
      // So if rate limited on our internal limiter, do we fallback? 
      // Usually rate limit protects our resources/budget. 
      // If we fallback to Google Translate (which might cost money), we might want to still respect rate limit?
      // Assuming rate limit is for Gemini usage or general API abuse.
      // If the user is rate limited, we probably should REJECT them, unless the rate limit is specific to Gemini quota.
      // But checkRateLimit here is IP-based generic limit. 
      // Let's return 429 for now as per standard practice. The "fallback" requirement likely applies to Gemini API limits/failures, not user IP rate limits.

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
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Validate request input
    const validation = validateRequest(requestData, 'translate');
    if (!validation.isValid) {
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
      return NextResponse.json(
        { 
          error: 'Content size exceeds 1MB limit',
          maxSize: '1MB'
        },
        { status: 413 }
      );
    }

    // Check DB cache first
    try {
      const cachedTranslation = await translationCache.get(sourceUrl!, chapterNumber!, text!);
      if (cachedTranslation) {
        const response = NextResponse.json({ 
          translatedText: cachedTranslation.translatedText,
          originalMarkdown: cachedTranslation.originalText,
          confidence: 1.0, // Cached result is considered high confidence
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
    } catch (cacheError) {
      console.error('Cache retrieval failed:', cacheError);
      // Continue to translation if cache fails
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'Translation service is not configured' },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const systemInstruction = `You are an expert literary translator and editor. 
Your goal is to produce a high-fidelity translation that reads like a native English novel while preserving the original meaning, character voice, and narrative tone.

Guidelines:
1. Proper Nouns: Detect and preserve all proper nouns (names of characters, places, sects, etc.). Capitalize them correctly. Do not translate names literally unless they are nicknames or titles best understood in translation.
2. Tone & Style: Analyze the text to determine the tone (e.g., action, romance, mystery). Maintain this tone. Action scenes should be fast-paced; romance emotional; descriptions vivid.
3. Natural Phrasing: Avoid robotic or literal translation. Rephrase sentences to flow naturally in English using idiomatic expressions where appropriate.
4. Formatting: Strict adherence to the original Markdown formatting (bold, italic, headers, lists).
5. Accuracy: Do not summarize or omit content. Translate the entire text.`;

    // Timeout wrapper for API calls
    const timeout = (promise: Promise<any>, ms: number) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout after 60 seconds')), ms)
        )
      ]);
    };

    let translation: string | undefined;
    let modelName = 'gemini-2.5-pro';
    let confidence = 0.95;
    let usedFallback = false;

    // Helper to run Gemini model
    const runGemini = async (modelId: string): Promise<string> => {
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction
      });
      const result = await timeout(model.generateContent(text!), 60000) as any;
      if (!result || !result.response) throw new Error('Invalid response structure');
      return result.response.text();
    };

    // 1. Try Gemini 2.5 Pro
    try {
      translation = await runGemini('gemini-2.5-pro');
    } catch (error: any) {
      console.log('gemini-2.5-pro failed:', error.message);
      
      // 2. Try Gemini 2.5 Flash
      try {
        modelName = 'gemini-2.5-flash';
        translation = await runGemini('gemini-2.5-flash');
        confidence = 0.9;
      } catch (flashError: any) {
        console.log('gemini-2.5-flash failed:', flashError.message);
        
        // 3. Fallback to Google Translate API
        if (process.env.GOOGLE_TRANSLATE_API_KEY || process.env.GEMINI_API_KEY) {
           // Assuming we might use GEMINI_API_KEY for Google Cloud Translate if it's the same project 
           // but usually they are different. We'll try GOOGLE_TRANSLATE_API_KEY first.
           const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY || process.env.GEMINI_API_KEY;
           try {
             modelName = 'google-translate-api';
             translation = await translateWithGoogle(text!, apiKey!);
             confidence = 0.7;
             usedFallback = true;
           } catch (gtError: any) {
             console.error('Google Translate fallback failed:', gtError);
             throw new Error('All translation services failed');
           }
        } else {
             throw new Error('All translation services failed and no Google Translate key available');
        }
      }
    }

    // Validate Output
    if (!translation || typeof translation !== 'string' || translation.trim().length === 0) {
      throw new Error('Empty translation received');
    }

    if (!isEnglish(translation)) {
      logSecurityEvent('TRANSLATE_VALIDATION_FAILED', {
         ip,
         reason: 'Output determined to be non-English'
      });
      // If it's not English, maybe we should return error or just return it with low confidence?
      // Requirement: "reject if output isn't proper English"
      return NextResponse.json(
        { error: 'Translation output validation failed: Result does not appear to be valid English' },
        { status: 502 }
      );
    }

    // Cache the successful translation
    try {
      await translationCache.set(sourceUrl!, chapterNumber!, text!, translation, modelName);
    } catch (e) {
      console.error('Failed to cache translation:', e);
    }

    const responseTime = Date.now() - startTime;
    const response = NextResponse.json({ 
      translatedText: translation,
      originalMarkdown: text,
      confidence,
      cached: false,
      model: modelName,
      responseTime
    });

    response.headers.set('X-Cache-Hit', 'false');
    response.headers.set('X-Response-Time', `${responseTime}ms`);
    response.headers.set('X-Model-Used', modelName);

    return response;

  } catch (error: any) {
    console.error('Translation Error:', error);
    
    const responseTime = Date.now() - startTime;
    
    // Check for timeout
    if (error.message?.includes('timeout') || error.message?.includes('timed out')) {
        return NextResponse.json(
          { 
            error: 'Translation request timed out',
            message: 'The translation service is taking too long to respond.',
          },
          { status: 504 }
        );
    }

    return NextResponse.json({ 
      error: 'Internal translation error',
      message: error.message || 'An unexpected error occurred.',
      requestId: Date.now().toString(),
      responseTime: `${responseTime}ms`
    }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { 
  getClientIP, 
  validateRequest, 
  logSecurityEvent, 
  isBotRequest 
} from '../lib/security';
import { checkRateLimit, RateLimiter } from '../lib/rate-limiter';

// CORS configuration
const corsOptions = {
  origin: [
    // Add your production domains here
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'http://localhost:3001',
    // Add other allowed origins as needed
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400 // 24 hours
};

function handleCors(request: NextRequest): NextResponse | null {
  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 200 });
    
    const origin = request.headers.get('origin');
    if (origin && corsOptions.origin.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    } else {
      response.headers.set('Access-Control-Allow-Origin', corsOptions.origin[0]);
    }
    
    response.headers.set('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    response.headers.set('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
    response.headers.set('Access-Control-Max-Age', corsOptions.maxAge.toString());
    
    return response;
  }
  
  return null;
}

function setCorsHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');
  
  if (origin && corsOptions.origin.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  } else if (origin) {
    // Log unauthorized CORS attempt
    const ip = getClientIP(request);
    logSecurityEvent('CORS_ORIGIN_DENIED', {
      ip,
      userAgent: request.headers.get('user-agent') || undefined,
      url: request.url,
      reason: 'Origin not allowed'
    });
  }
  
  response.headers.set('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
  response.headers.set('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
  
  return response;
}

// Helper function to check if a path should be processed
function shouldProcessPath(pathname: string): boolean {
  const apiPaths = ['/api/translate', '/api/scrape'];
  return apiPaths.some(path => pathname.startsWith(path));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Handle CORS for all requests
  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
  }
  
  // Only process API routes
  if (!shouldProcessPath(pathname)) {
    const response = NextResponse.next();
    return setCorsHeaders(response, request);
  }
  
  // Security validations
  const ip = getClientIP(request);
  const userAgent = request.headers.get('user-agent') || undefined;
  
  // Rate limiting check
  const rateLimitKey = RateLimiter.createKey(ip, pathname);
  const rateLimitResult = checkRateLimit(ip, pathname);
  
  if (!rateLimitResult?.success) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      ip,
      userAgent,
      url: request.url,
      reason: 'Rate limit exceeded'
    });
    
    const response = NextResponse.json(
      { 
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please try again later.',
        retryAfter: rateLimitResult?.retryAfter || 60
      },
      { status: 429 }
    );
    
    if (rateLimitResult?.retryAfter) {
      response.headers.set('Retry-After', rateLimitResult.retryAfter.toString());
    }
    response.headers.set('X-RateLimit-Limit', rateLimitResult?.total.toString() || '0');
    response.headers.set('X-RateLimit-Remaining', '0');
    response.headers.set('X-RateLimit-Reset', Math.ceil(rateLimitResult!.resetTime.getTime() / 1000).toString());
    
    return setCorsHeaders(response, request);
  }
  
  // Add rate limit headers to successful responses
  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', rateLimitResult?.total.toString() || '0');
  response.headers.set('X-RateLimit-Remaining', rateLimitResult?.remaining.toString() || '0');
  response.headers.set('X-RateLimit-Reset', Math.ceil(rateLimitResult!.resetTime.getTime() / 1000).toString());
  
  // Bot detection and logging
  if (isBotRequest(userAgent)) {
    logSecurityEvent('BOT_REQUEST', {
      ip,
      userAgent,
      url: request.url,
      reason: 'Likely bot or automated client'
    });
  }
  
  return setCorsHeaders(response, request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|public|.*\\..*).*)',
  ],
};
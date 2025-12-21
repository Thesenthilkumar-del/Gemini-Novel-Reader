# API Rate Limiting & Caching Documentation

## Overview

The Gemini Novel Reader API now includes comprehensive rate limiting, caching, and security features to protect the service and ensure reliable performance.

## Rate Limiting

### Limits
- **Per-minute**: 10 requests per IP address
- **Per-day**: 100 requests per IP address
- **Response**: 429 status with `Retry-After` header when exceeded

### Headers
All API responses include rate limiting headers:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Unix timestamp when limits reset

### Rate Limit Exceeded Response
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again later.",
  "retryAfter": 60
}
```

## Caching

### Cache Keys
- **Translation**: `translation:${hash(sourceUrl + chapterNumber + originalText)}`
- **Scrape**: `scrape:${hash(sourceUrl)}`

### TTL (Time To Live)
- **Translations**: 7 days
- **Scrape Results**: 24 hours

### Cache Headers
- `X-Cache-Hit`: "true" if response served from cache
- `X-Response-Time`: Total request time in milliseconds

## Security Features

### Input Validation
- URL sanitization to prevent SSRF attacks
- Domain allowlist for external requests
- Content size limits (1MB maximum)
- Chapter URL pattern validation

### Logging
Security events are logged with details:
- IP address and user agent
- Request URLs and validation failures
- Rate limit violations
- Suspicious patterns

## API Endpoints

### POST /api/translate

Translate chapter content using AI.

**Request:**
```json
{
  "text": "Chapter content to translate...",
  "sourceUrl": "https://example.com/novel/chapter-1",
  "chapterNumber": "1"
}
```

**Response:**
```json
{
  "translation": "Translated content...",
  "cached": false,
  "model": "gemini-2.5-pro",
  "responseTime": 1250
}
```

**Headers:**
- `X-Cache-Hit`: true/false
- `X-Response-Time`: Response time in ms
- `X-Model-Used`: AI model used
- `X-Fallback-Used`: true if fallback model was used

### POST /api/scrape

Scrape content from a chapter URL.

**Request:**
```json
{
  "url": "https://example.com/novel/chapter-1"
}
```

**Response:**
```json
{
  "content": "Scraped chapter content...",
  "sourceUrl": "https://example.com/novel/chapter-1",
  "cached": false,
  "responseTime": 850
}
```

### GET /api/scrape?action=stats

Get cache statistics.

**Response:**
```json
{
  "message": "Cache statistics",
  "stats": {
    "totalEntries": 42,
    "translationEntries": 35,
    "scrapeEntries": 7
  },
  "timestamp": 1703123456789
}
```

## Error Handling

### HTTP Status Codes
- **200**: Success
- **400**: Bad Request (validation failed)
- **401**: Unauthorized
- **429**: Rate Limit Exceeded
- **413**: Content Too Large
- **500**: Internal Server Error
- **502**: Bad Gateway (upstream service error)
- **504**: Gateway Timeout

### Error Response Format
```json
{
  "error": "Error type",
  "message": "Human-readable error message",
  "details": ["Additional error details"],
  "requestId": "1234567890",
  "responseTime": "1250ms"
}
```

## CORS Configuration

### Allowed Origins
- `http://localhost:3000`
- `http://localhost:3001`
- `https://yourdomain.com` (when configured)

### Preflight Support
The API supports CORS preflight requests with:
- `OPTIONS` method handling
- `Access-Control-Allow-Headers`: Content-Type, Authorization, X-Requested-With
- `Access-Control-Allow-Methods`: GET, POST, OPTIONS

## Performance Features

### Response Time Targets
- **Cached responses**: < 100ms
- **Fresh translations**: < 30 seconds (with 60s timeout)
- **Fresh scraping**: < 30 seconds (with 60s timeout)

### Performance Headers
- `X-Response-Time`: Total request duration
- `X-Content-Size`: Size of scraped content (for scrape API)

## Security Event Types

The system logs the following security events:
- `TRANSLATE_REQUEST_START`: Translation request initiated
- `RATE_LIMIT_EXCEEDED`: Rate limit violation
- `CORS_ORIGIN_DENIED`: Unauthorized CORS request
- `BOT_REQUEST`: Likely bot or automated client
- `TRANSLATE_VALIDATION_FAILED`: Request validation failed
- `SCRAPE_CONTENT_TOO_LARGE`: Content exceeds size limits
- `TRANSLATE_TIMEOUT`: Translation request timed out

## Monitoring & Debugging

### Request Tracing
Each request includes:
- Unique request ID for debugging
- Response time measurements
- Model information for translations
- Cache hit/miss status

### Log Format
```json
{
  "event": "TRANSLATE_SUCCESS",
  "timestamp": 1703123456789,
  "ip": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "url": "https://api.example.com/api/translate",
  "reason": "Response time: 1250ms, Model: gemini-2.5-pro",
  "level": "security"
}
```

## Environment Variables

- `GEMINI_API_KEY`: Google Gemini API key (required)
- `NEXT_PUBLIC_APP_URL`: Application URL for CORS (optional)

## Testing

Test utilities are available in `/app/lib/test-utils.ts`:

```typescript
import { runTests } from './lib/test-utils';

// Run all integration tests
await runTests();

// Or run individual tests
import { RateLimitTester, CacheTester } from './lib/test-utils';

const tester = new RateLimitTester();
await tester.testRateLimit(12);
```

## Migration Notes

### For Existing Clients
- No breaking changes to API interfaces
- Additional headers and response fields added
- Rate limiting may affect high-volume users
- Caching reduces subsequent response times

### Rate Limit Compliance
- Clients should respect `Retry-After` headers
- Implement exponential backoff for retries
- Monitor `X-RateLimit-Remaining` headers
- Consider request queuing for bulk operations

## Best Practices

1. **Handle Rate Limits Gracefully**: Respect 429 responses and retry-after headers
2. **Use Caching**: Cache translations to reduce API calls and improve performance
3. **Monitor Response Times**: Track performance with provided headers
4. **Implement Backoff**: Use exponential backoff for retries
5. **Validate Input**: Ensure URLs match expected patterns
6. **Handle Errors**: Implement proper error handling for all response types
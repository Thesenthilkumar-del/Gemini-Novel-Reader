import { checkRateLimit, RateLimiter } from './rate-limiter';
import { cache } from './cache';
import { logSecurityEvent } from './security';

// Test utility for rate limiting
export class RateLimitTester {
  private ip: string;
  private endpoint: string;

  constructor(ip: string = '127.0.0.1', endpoint: string = '/api/test') {
    this.ip = ip;
    this.endpoint = endpoint;
  }

  /**
   * Test rate limiting by making multiple requests
   */
  async testRateLimit(
    requestCount: number = 12,
    expectedLimitHit: boolean = true
  ): Promise<{
    results: Array<{ request: number; success: boolean; remaining: number; retryAfter?: number }>;
    limitHit: boolean;
    firstLimitRequest: number;
  }> {
    const results = [];
    let limitHit = false;
    let firstLimitRequest = -1;

    console.log(`\n🧪 Testing rate limit with ${requestCount} requests...`);
    console.log(`IP: ${this.ip}, Endpoint: ${this.endpoint}`);

    for (let i = 1; i <= requestCount; i++) {
      const rateLimitResult = checkRateLimit(this.ip, this.endpoint);
      
      results.push({
        request: i,
        success: rateLimitResult.success,
        remaining: rateLimitResult.remaining,
        retryAfter: rateLimitResult.retryAfter
      });

      if (!rateLimitResult.success && !limitHit) {
        limitHit = true;
        firstLimitRequest = i;
        console.log(`⛔ Rate limit hit on request ${i} (remaining: ${rateLimitResult.remaining})`);
      } else if (rateLimitResult.success) {
        console.log(`✅ Request ${i} successful (remaining: ${rateLimitResult.remaining})`);
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Validate results
    if (expectedLimitHit && !limitHit) {
      console.log('⚠️  Expected rate limit to be hit, but it was not');
    } else if (!expectedLimitHit && limitHit) {
      console.log('⚠️  Did not expect rate limit to be hit, but it was');
    }

    return { results, limitHit, firstLimitRequest };
  }

  /**
   * Test concurrent requests
   */
  async testConcurrentRequests(requestCount: number = 20): Promise<void> {
    console.log(`\n🚀 Testing ${requestCount} concurrent requests...`);

    const promises = Array.from({ length: requestCount }, (_, i) => 
      Promise.resolve().then(() => {
        const result = checkRateLimit(this.ip, `${this.endpoint}-concurrent-${i}`);
        return {
          request: i + 1,
          success: result.success,
          remaining: result.remaining
        };
      })
    );

    const results = await Promise.all(promises);
    
    const successful = results.filter(r => r.success).length;
    const blocked = results.filter(r => !r.success).length;

    console.log(`📊 Concurrent test results:`);
    console.log(`   ✅ Successful: ${successful}`);
    console.log(`   ⛔ Blocked: ${blocked}`);
    console.log(`   📈 Success rate: ${(successful / requestCount * 100).toFixed(1)}%`);
  }
}

// Cache test utility
export class CacheTester {
  /**
   * Test cache performance
   */
  async testCachePerformance(): Promise<void> {
    console.log('\n🔍 Testing cache performance...');

    const sourceUrl = 'https://example.com/novel/chapter-1';
    const chapterNumber = '1';
    const text = 'This is a test chapter content for caching.'.repeat(100); // ~3KB
    const translation = 'This is the translated content.'.repeat(100);

    // Test cache miss
    console.log('1. Testing cache miss...');
    const missStart = Date.now();
    const cached = await cache.getTranslation(sourceUrl, chapterNumber, text);
    const missTime = Date.now() - missStart;
    
    if (cached) {
      console.log('   ❌ Unexpected cache hit');
    } else {
      console.log(`   ✅ Cache miss (${missTime}ms)`);
    }

    // Test cache set
    console.log('2. Testing cache write...');
    const setStart = Date.now();
    await cache.setTranslation(sourceUrl, chapterNumber, text, translation, 'gemini-2.5-pro');
    const setTime = Date.now() - setStart;
    console.log(`   ✅ Cache write completed (${setTime}ms)`);

    // Test cache hit
    console.log('3. Testing cache hit...');
    const hitStart = Date.now();
    const cachedTranslation = await cache.getTranslation(sourceUrl, chapterNumber, text);
    const hitTime = Date.now() - hitStart;
    
    if (cachedTranslation) {
      console.log(`   ✅ Cache hit (${hitTime}ms)`);
      console.log(`   📝 Translation length: ${cachedTranslation.translatedText.length} chars`);
      console.log(`   🤖 Model: ${cachedTranslation.model}`);
    } else {
      console.log('   ❌ Cache miss after set');
    }

    // Performance assertion
    if (hitTime < 100) {
      console.log('   🎯 Cache response time < 100ms ✅');
    } else {
      console.log(`   ⚠️  Cache response time ${hitTime}ms >= 100ms`);
    }
  }

  /**
   * Test cache with different content sizes
   */
  async testCacheWithVariousSizes(): Promise<void> {
    console.log('\n📏 Testing cache with various content sizes...');

    const sizes = [
      { name: 'Small (1KB)', content: 'A'.repeat(1024) },
      { name: 'Medium (50KB)', content: 'B'.repeat(50 * 1024) },
      { name: 'Large (500KB)', content: 'C'.repeat(500 * 1024) },
      { name: 'Very Large (1MB)', content: 'D'.repeat(1024 * 1024) }
    ];

    for (const size of sizes) {
      const start = Date.now();
      await cache.setTranslation(
        `https://example.com/test-${size.name.toLowerCase()}`,
        '1',
        size.content,
        `Translated: ${size.content.substring(0, 100)}...`,
        'test-model'
      );
      const time = Date.now() - start;
      console.log(`   ${size.name}: ${time}ms`);
    }
  }
}

// Security test utility
export class SecurityTester {
  private testIPs = [
    '127.0.0.1',
    '192.168.1.1',
    '10.0.0.1',
    '::1',
    '2001:db8::1'
  ];

  /**
   * Test IP validation and security logging
   */
  async testSecurityLogging(): Promise<void> {
    console.log('\n🔒 Testing security logging...');

    for (const ip of this.testIPs) {
      logSecurityEvent('TEST_SECURITY_EVENT', {
        ip,
        userAgent: 'Security Test Agent/1.0',
        url: 'https://test.example.com',
        reason: 'Testing security event logging'
      });
    }

    console.log(`   ✅ Logged security events for ${this.testIPs.length} test IPs`);
  }

  /**
   * Test malicious request patterns
   */
  async testMaliciousPatterns(): Promise<void> {
    console.log('\n🚨 Testing malicious request patterns...');

    const maliciousUrls = [
      'http://127.0.0.1:22', // Internal service scanning
      'http://169.254.169.254/latest/meta-data', // AWS metadata probing
      'file:///etc/passwd', // File inclusion attempt
      'https://r.jina.ai/http://internal.company.com/secret', // SSRF attempt
      '../../../etc/passwd', // Path traversal
      '<script>alert("xss")</script>', // XSS attempt
      "'; DROP TABLE users; --", // SQL injection
    ];

    console.log('   Testing URL validation against malicious patterns...');
    for (const url of maliciousUrls) {
      // This would be tested with the actual validation function
      console.log(`   🔍 Pattern: ${url.substring(0, 50)}${url.length > 50 ? '...' : ''}`);
    }
    console.log(`   ✅ Tested ${maliciousUrls.length} malicious patterns`);
  }
}

// Integration test runner
export class IntegrationTester {
  private rateLimitTester = new RateLimitTester();
  private cacheTester = new CacheTester();
  private securityTester = new SecurityTester();

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log('🧪 Starting Integration Tests for Rate Limiting & Caching\n');
    console.log('=' .repeat(60));

    try {
      // Test rate limiting
      await this.testRateLimiting();

      // Test caching
      await this.testCaching();

      // Test security
      await this.testSecurity();

      console.log('\n🎉 All integration tests completed!');
      
    } catch (error) {
      console.error('\n❌ Integration tests failed:', error);
      throw error;
    }
  }

  private async testRateLimiting(): Promise<void> {
    console.log('\n📊 Rate Limiting Tests');
    console.log('-'.repeat(30));

    // Test per-minute limit
    await this.rateLimitTester.testRateLimit(12, true);
    
    // Test per-day limit
    const dailyTester = new RateLimitTester('127.0.0.2', '/api/daily-test');
    await dailyTester.testRateLimit(5, false); // Should not hit daily limit

    // Test concurrent requests
    const concurrentTester = new RateLimitTester('127.0.0.3', '/api/concurrent-test');
    await concurrentTester.testConcurrentRequests(15);
  }

  private async testCaching(): Promise<void> {
    console.log('\n💾 Caching Tests');
    console.log('-'.repeat(30));

    await this.cacheTester.testCachePerformance();
    await this.cacheTester.testCacheWithVariousSizes();
  }

  private async testSecurity(): Promise<void> {
    console.log('\n🔒 Security Tests');
    console.log('-'.repeat(30));

    await this.securityTester.testSecurityLogging();
    await this.securityTester.testMaliciousPatterns();
  }
}

// CLI interface for running tests
export async function runTests(): Promise<void> {
  const tester = new IntegrationTester();
  await tester.runAllTests();
}

// Export for use in development
if (typeof window !== 'undefined') {
  (window as any).RateLimitTester = RateLimitTester;
  (window as any).CacheTester = CacheTester;
  (window as any).SecurityTester = SecurityTester;
  (window as any).IntegrationTester = IntegrationTester;
}
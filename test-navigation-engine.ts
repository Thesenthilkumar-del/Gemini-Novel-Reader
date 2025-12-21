// Test suite for the Smart Chapter Navigation Engine
// Run this to validate the implementation against various URL patterns

import { extractChapterIdentifier, UrlGenerator, UrlValidator, NavigationScraper, PatternDetector } from './app/lib/url-prediction';
import { patternStorage, navigationEngine } from './app/lib/pattern-storage';

interface TestCase {
  name: string;
  url: string;
  expectedIdentifier: string | null;
  expectedType: 'numeric' | 'alphanumeric' | null;
  minConfidence: number;
  checkNext?: boolean;
  checkPrev?: boolean;
}

const testCases: TestCase[] = [
  // Numeric patterns
  { name: 'Chapter pattern', url: 'https://example.com/novel/story/chapter-50', expectedIdentifier: '50', expectedType: 'numeric', minConfidence: 0.5 },
  { name: 'Ch pattern', url: 'https://example.com/novel/story/ch-25', expectedIdentifier: '25', expectedType: 'numeric', minConfidence: 0.5 },
  { name: 'Slash numeric', url: 'https://example.com/novel/story/123', expectedIdentifier: '123', expectedType: 'numeric', minConfidence: 0.5 },
  { name: 'Chapter without hyphen', url: 'https://example.com/novel/story/chapter42', expectedIdentifier: '42', expectedType: 'numeric', minConfidence: 0.5 },
  { name: 'HTML suffix', url: 'https://example.com/novel/story/99.html', expectedIdentifier: '99', expectedType: 'numeric', minConfidence: 0.5 },
  { name: 'Page pattern', url: 'https://example.com/novel/story/page-10', expectedIdentifier: '10', expectedType: 'numeric', minConfidence: 0.5 },
  { name: 'Part pattern', url: 'https://example.com/novel/story/part-7', expectedIdentifier: '7', expectedType: 'numeric', minConfidence: 0.5 },
  { name: 'Volume pattern', url: 'https://example.com/novel/story/vol-3', expectedIdentifier: '3', expectedType: 'numeric', minConfidence: 0.5 },
  { name: 'Episode pattern', url: 'https://example.com/novel/story/episode-15', expectedIdentifier: '15', expectedType: 'numeric', minConfidence: 0.5 },
  
  // Alphanumeric patterns
  { name: 'Alphanumeric chapter', url: 'https://example.com/novel/story/chapter-1a', expectedIdentifier: '1a', expectedType: 'alphanumeric', minConfidence: 0.5 },
  { name: 'Alphanumeric ch', url: 'https://example.com/novel/story/ch-2b', expectedIdentifier: '2b', expectedType: 'alphanumeric', minConfidence: 0.5 },
  { name: 'Alphanumeric HTML', url: 'https://example.com/novel/story/3c.html', expectedIdentifier: '3c', expectedType: 'alphanumeric', minConfidence: 0.5 },
  
  // Special chapter patterns
  { name: 'Prologue', url: 'https://example.com/novel/story/prologue', expectedIdentifier: 'prologue', expectedType: 'alphanumeric', minConfidence: 0.2 },
  { name: 'Epilogue', url: 'https://example.com/novel/story/epilogue', expectedIdentifier: 'epilogue', expectedType: 'alphanumeric', minConfidence: 0.2 },
  { name: 'Bonus chapter', url: 'https://example.com/novel/story/bonus-1', expectedIdentifier: 'bonus-1', expectedType: 'alphanumeric', minConfidence: 0.2 },
  
  // Edge cases
  { name: 'Chinese site format', url: 'https://example.com/novel/story/第50章', expectedIdentifier: null, expectedType: null, minConfidence: 0 },
  { name: 'Query parameter', url: 'https://example.com/novel/story/chapter-5?lang=en', expectedIdentifier: '5', expectedType: 'numeric', minConfidence: 0.5 },
  
  // Common novel site patterns
  { name: 'Wuxiaworld style', url: 'https://wuxiaworld.com/novel/story/chapter-50', expectedIdentifier: '50', expectedType: 'numeric', minConfidence: 0.5 },
  { name: 'Webnovel style', url: 'https://webnovel.com/book/story/chapter-0100_100', expectedIdentifier: '0100_100', expectedType: 'alphanumeric', minConfidence: 0.3 },
  { name: 'Royal Road style', url: 'https://royalroad.com/fiction/chapter/123456', expectedIdentifier: '123456', expectedType: 'numeric', minConfidence: 0.3 },
];

async function runTests() {
  console.log('🚀 Testing Smart Chapter Navigation Engine\n');
  
  let passed = 0;
  let failed = 0;
  
  console.log('📋 Testing URL Pattern Detection:');
  console.log('═══════════════════════════════════');
  
  for (const testCase of testCases) {
    try {
      const result = extractChapterIdentifier(testCase.url);
      
      const identifierMatch = result.identifier === testCase.expectedIdentifier;
      const typeMatch = result.type === testCase.expectedType;
      
      if (identifierMatch && typeMatch) {
        console.log(`✅ ${testCase.name}: ${result.pattern || 'manual'} (${result.identifier || 'none'})`);
        passed++;
      } else {
        console.log(`❌ ${testCase.name}`);
        console.log(`   Expected: identifier="${testCase.expectedIdentifier}", type="${testCase.expectedType}"`);
        console.log(`   Got: identifier="${result.identifier}", type="${result.type}"`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${testCase.name} - Error: ${error}`);
      failed++;
    }
  }
  
  console.log('\n📋 Testing Pattern Learning:');
  console.log('═══════════════════════════════');
  
  // Test pattern learning
  const testUrl = 'https://example.com/novel/story/chapter-50';
  const pattern = PatternDetector.learnPattern(testUrl);
  
  if (pattern && pattern.domain === 'example.com' && pattern.pattern.includes('{number}')) {
    console.log(`✅ Pattern learning: Learned pattern ${pattern.pattern}`);
    passed++;
  } else {
    console.log(`❌ Pattern learning: Failed to learn valid pattern`);
    failed++;
  }
  
  console.log('\n📋 Testing URL Generation:');
  console.log('═══════════════════════════════');
  
  // Test URL generation for numeric patterns
  const numericPattern = {
    domain: 'example.com',
    pattern: '/novel/story/chapter-{number}',
    exampleUrl: 'https://example.com/novel/story/chapter-50',
    chapterIdentifier: 'numeric' as const,
    confidence: 0.8,
    lastUsed: Date.now(),
    successRate: 0.8
  };
  
  const nextUrl = UrlGenerator.generateNextUrl('https://example.com/novel/story/chapter-50', numericPattern);
  const prevUrl = UrlGenerator.generatePrevUrl('https://example.com/novel/story/chapter-50', numericPattern);
  
  if (nextUrl === 'https://example.com/novel/story/chapter-51') {
    console.log(`✅ Next URL generation: ${nextUrl}`);
    passed++;
  } else {
    console.log(`❌ Next URL generation: Expected "...chapter-51", got "${nextUrl}"`);
    failed++;
  }
  
  if (prevUrl === 'https://example.com/novel/story/chapter-49') {
    console.log(`✅ Previous URL generation: ${prevUrl}`);
    passed++;
  } else {
    console.log(`❌ Previous URL generation: Expected "...chapter-49", got "${prevUrl}"`);
    failed++;
  }
  
  // Test alphanumeric increment
  const alphaPattern = {
    ...numericPattern,
    chapterIdentifier: 'alphanumeric' as const
  };
  
  const nextAlphaUrl = UrlGenerator.generateNextUrl('https://example.com/novel/story/chapter-1a', alphaPattern);
  if (nextAlphaUrl === 'https://example.com/novel/story/chapter-1b') {
    console.log(`✅ Alphanumeric generation: 1a → 1b`);
    passed++;
  } else {
    console.log(`❌ Alphanumeric generation: Expected "...chapter-1b", got "${nextAlphaUrl}"`);
    failed++;
  }
  
  console.log('\n📋 Testing Integration:');
  console.log('═══════════════════════════════');
  
  // Test the full navigation engine
  try {
    const result = await navigationEngine.predictNavigation('https://example.com/novel/story/chapter-100');
    
    if (result.confidence > 0 && (result.nextUrl || result.previousUrl)) {
      console.log(`✅ Navigation engine: Confidence=${result.confidence}, Method=${result.method}`);
      console.log(`   Next: ${result.nextUrl}`);
      console.log(`   Prev: ${result.previousUrl}`);
      passed++;
    } else {
      console.log(`❌ Navigation engine: Failed to predict navigation`);
      failed++;
    }
  } catch (error) {
    console.log(`❌ Navigation engine error: ${error}`);
    failed++;
  }
  
  console.log('\n📋 Summary:');
  console.log('═══════════');
  console.log(`Total tests: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  
  return { passed, failed };
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

export { runTests };

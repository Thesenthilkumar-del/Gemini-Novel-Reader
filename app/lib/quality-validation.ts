/**
 * Translation quality validation and scoring
 */

export interface QualityScore {
  score: number; // 0-10
  isAcceptable: boolean;
  issues: string[];
  warnings: string[];
}

const ACCEPTABLE_THRESHOLD = 5;

/**
 * Validate translation quality and return score
 */
export function validateTranslationQuality(
  original: string,
  translated: string
): QualityScore {
  const issues: string[] = [];
  const warnings: string[] = [];
  let score = 10;

  // Check if translation exists
  if (!translated || translated.trim().length === 0) {
    issues.push('Translation is empty');
    return {
      score: 0,
      isAcceptable: false,
      issues,
      warnings
    };
  }

  // Check if translation is too short compared to original
  const lengthRatio = translated.length / original.length;
  if (lengthRatio < 0.3) {
    issues.push('Translation is suspiciously short');
    score -= 3;
  } else if (lengthRatio < 0.5) {
    warnings.push('Translation is shorter than expected');
    score -= 1;
  }

  // Check if translation is just a copy of original
  const similarity = calculateSimilarity(original, translated);
  if (similarity > 0.9) {
    issues.push('Translation appears to be identical to original');
    score -= 4;
  } else if (similarity > 0.7) {
    warnings.push('Translation is very similar to original text');
    score -= 2;
  }

  // Check for English characteristics
  const englishScore = checkEnglishCharacteristics(translated);
  if (englishScore < 0.5) {
    issues.push('Translation does not appear to be valid English');
    score -= 4;
  } else if (englishScore < 0.7) {
    warnings.push('Translation quality may be low');
    score -= 2;
  }

  // Check for common translation artifacts
  const artifacts = detectTranslationArtifacts(translated);
  if (artifacts.length > 0) {
    warnings.push(...artifacts);
    score -= artifacts.length * 0.5;
  }

  // Check for formatting preservation
  if (!checkFormattingPreservation(original, translated)) {
    warnings.push('Some formatting may have been lost');
    score -= 0.5;
  }

  // Ensure score is within bounds
  score = Math.max(0, Math.min(10, score));

  return {
    score: Math.round(score * 10) / 10, // Round to 1 decimal
    isAcceptable: score >= ACCEPTABLE_THRESHOLD,
    issues,
    warnings
  };
}

/**
 * Calculate similarity between two texts (simple version)
 */
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * Check for English characteristics
 */
function checkEnglishCharacteristics(text: string): number {
  let score = 0;
  const lowerText = text.toLowerCase();

  // Check ASCII ratio
  const asciiCount = (text.match(/[\u0000-\u007F]/g) || []).length;
  const asciiRatio = asciiCount / text.length;
  score += asciiRatio * 0.3; // 30% weight

  // Check for common English words
  const commonWords = [
    'the', 'and', 'is', 'in', 'to', 'of', 'it', 'that', 'was', 'for',
    'with', 'he', 'she', 'they', 'his', 'her', 'had', 'have', 'but',
    'not', 'you', 'are', 'this', 'from', 'or', 'as', 'be', 'at', 'by'
  ];
  
  const words = lowerText.split(/\s+/);
  const commonWordCount = words.filter(w => commonWords.includes(w)).length;
  const commonWordRatio = words.length > 0 ? commonWordCount / words.length : 0;
  score += Math.min(commonWordRatio * 2, 0.4); // 40% weight, capped

  // Check for proper sentence structure (starts with capital, ends with punctuation)
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  let properSentences = 0;
  sentences.forEach(sentence => {
    const trimmed = sentence.trim();
    if (trimmed.length > 0 && /^[A-Z]/.test(trimmed)) {
      properSentences++;
    }
  });
  const sentenceScore = sentences.length > 0 ? properSentences / sentences.length : 0;
  score += sentenceScore * 0.3; // 30% weight

  return Math.min(score, 1);
}

/**
 * Detect common translation artifacts
 */
function detectTranslationArtifacts(text: string): string[] {
  const artifacts: string[] = [];

  // Check for untranslated Chinese/Japanese/Korean characters
  if (/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text)) {
    artifacts.push('Contains untranslated Asian characters');
  }

  // Check for common machine translation markers
  const mtMarkers = [
    /\[machine translation\]/i,
    /\[MTL\]/i,
    /\[auto.?translated\]/i,
    /\[google translate\]/i
  ];
  
  mtMarkers.forEach(marker => {
    if (marker.test(text)) {
      artifacts.push('Contains machine translation markers');
    }
  });

  // Check for excessive repetition
  const words = text.split(/\s+/);
  const uniqueWords = new Set(words);
  if (words.length > 50 && uniqueWords.size / words.length < 0.3) {
    artifacts.push('Excessive word repetition detected');
  }

  // Check for malformed sentences (too many consecutive non-alphabetic chars)
  if (/[^a-zA-Z\s]{10,}/.test(text)) {
    artifacts.push('Contains malformed text segments');
  }

  return artifacts;
}

/**
 * Check if formatting is preserved
 */
function checkFormattingPreservation(original: string, translated: string): boolean {
  // Count markdown headers
  const originalHeaders = (original.match(/^#+\s/gm) || []).length;
  const translatedHeaders = (translated.match(/^#+\s/gm) || []).length;
  
  // Allow some variance but flag if drastically different
  if (originalHeaders > 0 && Math.abs(originalHeaders - translatedHeaders) > 2) {
    return false;
  }

  // Count paragraphs (double newlines)
  const originalParas = (original.match(/\n\n+/g) || []).length;
  const translatedParas = (translated.match(/\n\n+/g) || []).length;
  
  if (originalParas > 0 && Math.abs(originalParas - translatedParas) > originalParas * 0.5) {
    return false;
  }

  return true;
}

/**
 * Get quality description
 */
export function getQualityDescription(score: number): string {
  if (score >= 9) return 'Excellent';
  if (score >= 7) return 'Good';
  if (score >= 5) return 'Acceptable';
  if (score >= 3) return 'Poor';
  return 'Very Poor';
}

/**
 * Check if output is actually English (enhanced version)
 */
export function isValidEnglish(text: string): boolean {
  if (!text || text.length === 0) return false;
  
  const englishScore = checkEnglishCharacteristics(text);
  return englishScore >= 0.7;
}

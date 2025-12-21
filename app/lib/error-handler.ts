/**
 * Comprehensive error handling and classification system
 */

export enum ErrorCategory {
  SCRAPER = 'SCRAPER',
  TRANSLATION = 'TRANSLATION',
  API = 'API',
  NETWORK = 'NETWORK',
  VALIDATION = 'VALIDATION',
  UNKNOWN = 'UNKNOWN'
}

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface AppError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  userMessage: string;
  originalError?: Error | unknown;
  timestamp: number;
  recoverable: boolean;
  suggestions: string[];
  context?: Record<string, any>;
}

export class ErrorHandler {
  private static errorLog: AppError[] = [];
  private static maxLogSize = 100;

  /**
   * Classify and handle an error
   */
  static handle(error: unknown, context?: Record<string, any>): AppError {
    const appError = this.classify(error, context);
    this.log(appError);
    return appError;
  }

  /**
   * Classify an error into categories
   */
  static classify(error: unknown, context?: Record<string, any>): AppError {
    const timestamp = Date.now();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const lowerMessage = errorMessage.toLowerCase();

    // Network errors
    if (
      lowerMessage.includes('network') ||
      lowerMessage.includes('fetch failed') ||
      lowerMessage.includes('connection') ||
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('timed out') ||
      lowerMessage.includes('offline') ||
      lowerMessage.includes('enotfound') ||
      lowerMessage.includes('econnrefused')
    ) {
      return {
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.MEDIUM,
        message: errorMessage,
        userMessage: 'Network connection issue. Please check your internet connection.',
        originalError: error,
        timestamp,
        recoverable: true,
        suggestions: [
          'Check your internet connection',
          'Try again in a few moments',
          'Content may be available from cache'
        ],
        context
      };
    }

    // Scraper errors
    if (
      lowerMessage.includes('scrape') ||
      lowerMessage.includes('content extraction') ||
      lowerMessage.includes('fetch novel') ||
      lowerMessage.includes('failed to fetch') ||
      context?.source === 'scraper'
    ) {
      return {
        category: ErrorCategory.SCRAPER,
        severity: ErrorSeverity.MEDIUM,
        message: errorMessage,
        userMessage: 'Failed to extract content from the page.',
        originalError: error,
        timestamp,
        recoverable: true,
        suggestions: [
          'Try a different chapter URL',
          'Check if the source website is accessible',
          'You can manually paste the chapter content'
        ],
        context
      };
    }

    // Translation errors
    if (
      lowerMessage.includes('translat') ||
      lowerMessage.includes('gemini') ||
      lowerMessage.includes('generative') ||
      lowerMessage.includes('model') ||
      context?.source === 'translation'
    ) {
      return {
        category: ErrorCategory.TRANSLATION,
        severity: ErrorSeverity.HIGH,
        message: errorMessage,
        userMessage: 'Translation service encountered an error.',
        originalError: error,
        timestamp,
        recoverable: true,
        suggestions: [
          'Retry the translation',
          'Fallback to Google Translate will be attempted',
          'Check if content is too long'
        ],
        context
      };
    }

    // API errors (rate limiting, quota, etc.)
    if (
      lowerMessage.includes('rate limit') ||
      lowerMessage.includes('quota') ||
      lowerMessage.includes('429') ||
      lowerMessage.includes('too many requests') ||
      lowerMessage.includes('api') ||
      context?.statusCode === 429
    ) {
      return {
        category: ErrorCategory.API,
        severity: ErrorSeverity.HIGH,
        message: errorMessage,
        userMessage: 'API rate limit exceeded. Please wait before trying again.',
        originalError: error,
        timestamp,
        recoverable: true,
        suggestions: [
          'Wait a few minutes before retrying',
          'Cached content may be available',
          'Contact support if issue persists'
        ],
        context
      };
    }

    // Validation errors
    if (
      lowerMessage.includes('validat') ||
      lowerMessage.includes('invalid') ||
      lowerMessage.includes('not english') ||
      context?.source === 'validation'
    ) {
      return {
        category: ErrorCategory.VALIDATION,
        severity: ErrorSeverity.MEDIUM,
        message: errorMessage,
        userMessage: 'Content validation failed.',
        originalError: error,
        timestamp,
        recoverable: true,
        suggestions: [
          'Try a different URL',
          'Check if the content is in the expected format',
          'Manual review may be required'
        ],
        context
      };
    }

    // Unknown error
    return {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      message: errorMessage,
      userMessage: 'An unexpected error occurred.',
      originalError: error,
      timestamp,
      recoverable: false,
      suggestions: [
        'Try refreshing the page',
        'Contact support if issue persists'
      ],
      context
    };
  }

  /**
   * Log error to internal log
   */
  static log(error: AppError): void {
    this.errorLog.push(error);
    
    // Keep log size manageable
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift();
    }

    // Console log for debugging
    console.error('[ErrorHandler]', {
      category: error.category,
      severity: error.severity,
      message: error.message,
      userMessage: error.userMessage,
      timestamp: new Date(error.timestamp).toISOString(),
      context: error.context
    });
  }

  /**
   * Get recent errors
   */
  static getRecentErrors(count: number = 10): AppError[] {
    return this.errorLog.slice(-count);
  }

  /**
   * Clear error log
   */
  static clearLog(): void {
    this.errorLog = [];
  }

  /**
   * Get errors by category
   */
  static getErrorsByCategory(category: ErrorCategory): AppError[] {
    return this.errorLog.filter(err => err.category === category);
  }

  /**
   * Check if network is available
   */
  static isOnline(): boolean {
    if (typeof window !== 'undefined' && 'navigator' in window) {
      return navigator.onLine;
    }
    return true; // Assume online in server context
  }

  /**
   * Create a user-friendly error message
   */
  static formatErrorMessage(error: AppError, includeDetails: boolean = false): string {
    let message = error.userMessage;
    
    if (includeDetails && error.message) {
      message += `\n\nDetails: ${error.message}`;
    }

    if (error.suggestions.length > 0) {
      message += '\n\nSuggested actions:\n' + error.suggestions.map(s => `• ${s}`).join('\n');
    }

    return message;
  }
}

/**
 * Utility function to handle errors consistently
 */
export function handleError(error: unknown, context?: Record<string, any>): AppError {
  return ErrorHandler.handle(error, context);
}

/**
 * Check if an error is recoverable
 */
export function isRecoverableError(error: AppError): boolean {
  return error.recoverable;
}

/**
 * Get error suggestions
 */
export function getErrorSuggestions(error: AppError): string[] {
  return error.suggestions;
}

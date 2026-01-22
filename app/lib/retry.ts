/**
 * Retry logic with exponential backoff
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: any) => void;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: any;
  attempts: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 4, // Total of 4 retries (1s, 2s, 4s, 8s)
  initialDelay: 1000, // 1 second
  maxDelay: 8000, // 8 seconds
  backoffMultiplier: 2,
  onRetry: () => {}
};

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;
  let delay = opts.initialDelay;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const data = await fn();
      return {
        success: true,
        data,
        attempts: attempt + 1
      };
    } catch (error) {
      lastError = error;
      
      // If this was the last attempt, don't wait
      if (attempt === opts.maxRetries) {
        break;
      }

      // Call retry callback
      opts.onRetry(attempt + 1, error);

      // Wait before next retry
      await sleep(delay);
      
      // Calculate next delay with exponential backoff
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelay);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: opts.maxRetries + 1
  };
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a fetch request with exponential backoff
 */
export async function retryFetch(
  url: string,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const result = await retryWithBackoff(
    async () => {
      const response = await fetch(url, init);
      
      // Consider 5xx errors as retryable
      if (response.status >= 500) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
      
      // Consider 429 (rate limit) as retryable
      if (response.status === 429) {
        throw new Error('Rate limit exceeded');
      }
      
      return response;
    },
    options
  );

  if (!result.success) {
    throw result.error;
  }

  return result.data!;
}

/**
 * Queue for failed requests to retry when back online
 */
export class RequestQueue {
  private queue: Array<{
    id: string;
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timestamp: number;
  }> = [];

  private processing = false;
  private maxQueueSize = 50;
  private maxAge = 5 * 60 * 1000; // 5 minutes

  /**
   * Add a request to the queue
   */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${Math.random()}`;
      
      // Clean old items
      this.cleanQueue();
      
      // Check queue size
      if (this.queue.length >= this.maxQueueSize) {
        reject(new Error('Request queue is full'));
        return;
      }

      this.queue.push({
        id,
        fn,
        resolve,
        reject,
        timestamp: Date.now()
      });

      // Start processing if not already
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      try {
        const result = await item.fn();
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }

      // Small delay between requests
      await sleep(100);
    }

    this.processing = false;
  }

  /**
   * Clean old items from queue
   */
  private cleanQueue(): void {
    const now = Date.now();
    this.queue = this.queue.filter(item => {
      const age = now - item.timestamp;
      if (age > this.maxAge) {
        item.reject(new Error('Request expired in queue'));
        return false;
      }
      return true;
    });
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue.forEach(item => {
      item.reject(new Error('Queue cleared'));
    });
    this.queue = [];
  }
}

// Singleton instance
export const requestQueue = new RequestQueue();

/**
 * Execute a request with retry and queue support
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions & { useQueue?: boolean }
): Promise<T> {
  // Check if online
  if (typeof window !== 'undefined' && !navigator.onLine) {
    if (options?.useQueue) {
      return requestQueue.enqueue(fn);
    }
    throw new Error('You are offline. Please check your internet connection.');
  }

  const result = await retryWithBackoff(fn, options);
  
  if (!result.success) {
    throw result.error;
  }

  return result.data!;
}

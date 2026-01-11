// Rate Limiter Utility for Token API Calls
// Prevents 429 (Too Many Requests) errors by throttling API calls

// Simple rate limiter class
export class RateLimiter {
  constructor(maxRequests = 5, windowMs = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }

  async acquire() {
    const now = Date.now();
    
    // Remove requests outside the window
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      // Wait until the oldest request expires
      const waitTime = this.windowMs - (now - this.requests[0]) + 10;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.acquire(); // Retry
    }
    
    this.requests.push(now);
    return true;
  }
}

// Global rate limiter for XDEX API (5 requests per second)
const xdexRateLimiter = new RateLimiter(5, 1000);

// Global rate limiter for RPC calls (10 requests per second)
const rpcRateLimiter = new RateLimiter(10, 1000);

// Cache for failed requests to avoid retrying them repeatedly
const failedRequestsCache = new Map();
const FAILED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Check if a request recently failed
export function hasRecentlyFailed(key) {
  const failedAt = failedRequestsCache.get(key);
  if (!failedAt) return false;
  
  if (Date.now() - failedAt > FAILED_CACHE_TTL) {
    failedRequestsCache.delete(key);
    return false;
  }
  
  return true;
}

// Mark a request as failed
export function markFailed(key) {
  failedRequestsCache.set(key, Date.now());
}

// Clear a failed mark (when request succeeds)
export function clearFailed(key) {
  failedRequestsCache.delete(key);
}

// Fetch with rate limiting for XDEX API
export async function fetchWithRateLimit(url, options = {}) {
  await xdexRateLimiter.acquire();
  return fetch(url, options);
}

// Fetch RPC with rate limiting and 429 retry
export async function fetchRpcWithRetry(rpcUrl, body, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await rpcRateLimiter.acquire();
    
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      });
      
      if (response.status === 429) {
        // Rate limited - exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`[RPC] Rate limited (429), waiting ${delay}ms before retry ${attempt}/${maxRetries}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      return response;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      // Network error - short delay before retry
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  throw new Error('RPC request failed after max retries');
}

// Batch processor for token metadata enrichment
export class BatchProcessor {
  constructor(batchSize = 5, delayBetweenBatches = 200) {
    this.batchSize = batchSize;
    this.delayBetweenBatches = delayBetweenBatches;
  }

  async processBatch(items, processor) {
    const results = [];
    
    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize);
      
      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(item => processor(item))
      );
      
      results.push(...batchResults);
      
      // Delay before next batch (unless this is the last batch)
      if (i + this.batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
      }
    }
    
    return results;
  }
}

// Default batch processor for token enrichment
export const tokenBatchProcessor = new BatchProcessor(5, 300);

// Exponential backoff retry helper
export async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 500) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if it's a rate limit error
      if (error.status === 429 || error.message?.includes('429')) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        console.log(`[RateLimiter] Rate limited, waiting ${delay}ms before retry ${attempt}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else if (attempt < maxRetries) {
        // For other errors, shorter delay
        await new Promise(resolve => setTimeout(resolve, initialDelayMs * attempt));
      } else {
        throw lastError;
      }
    }
  }
  
  throw lastError;
}
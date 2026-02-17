function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const directStatus = (error as { status?: unknown }).status;
  if (typeof directStatus === "number") {
    return directStatus;
  }

  const responseStatus = (error as { response?: { status?: unknown } }).response?.status;
  return typeof responseStatus === "number" ? responseStatus : undefined;
}

function getRateLimitHeader(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const headers = (error as { response?: { headers?: Record<string, unknown> } }).response
    ?.headers;

  const value =
    headers?.["x-amzn-ratelimit-limit"] ??
    headers?.["x-amzn-ratelimit"] ??
    headers?.["x-amzn-rate-limit-limit"];

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function getRetryDelayMs(
  error: unknown,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const status = getStatusCode(error);

  if (status === 429) {
    const rateLimit = getRateLimitHeader(error);
    if (rateLimit) {
      const delay = Math.ceil(1000 / rateLimit) + 1500;
      return Math.min(Math.max(delay, baseDelayMs), maxDelayMs);
    }
  }

  const exponential = baseDelayMs * 2 ** (attempt - 1);
  return Math.min(exponential, maxDelayMs);
}

function isRetryable(error: unknown): boolean {
  const status = getStatusCode(error);

  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withSpApiRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 2500;
  const maxDelayMs = options.maxDelayMs ?? 60_000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === attempts || !isRetryable(error)) {
        throw error;
      }

      await sleep(getRetryDelayMs(error, attempt, baseDelayMs, maxDelayMs));
    }
  }

  throw lastError;
}

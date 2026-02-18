import { NextRequest, NextResponse } from "next/server";

const INTERNAL_TOKEN_HEADER = "x-internal-api-token";
const REQUEST_ID_HEADER = "x-request-id";

const SYNC_RATE_LIMIT_WINDOW_MS = 60_000;
const SYNC_RATE_LIMIT_MAX_REQUESTS = 12;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const syncRateLimitStore = new Map<string, RateLimitEntry>();

function getConfiguredInternalToken(): string | undefined {
  return (
    process.env.INTERNAL_API_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_INTERNAL_API_TOKEN?.trim()
  );
}

function isProtectedApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/sync/") || pathname.startsWith("/api/settings/");
}

function shouldApplySyncRateLimit(request: NextRequest): boolean {
  return request.method === "POST" && request.nextUrl.pathname.startsWith("/api/sync/");
}

function getRateLimitKey(request: NextRequest): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";

  return `${ip}:${request.nextUrl.pathname}`;
}

function isSyncRateLimited(request: NextRequest): boolean {
  const key = getRateLimitKey(request);
  const now = Date.now();
  const existing = syncRateLimitStore.get(key);

  if (!existing || now - existing.windowStart >= SYNC_RATE_LIMIT_WINDOW_MS) {
    syncRateLimitStore.set(key, {
      count: 1,
      windowStart: now,
    });
    return false;
  }

  existing.count += 1;
  syncRateLimitStore.set(key, existing);

  return existing.count > SYNC_RATE_LIMIT_MAX_REQUESTS;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (!isProtectedApiPath(pathname)) {
    return NextResponse.next();
  }

  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  const configuredToken = getConfiguredInternalToken();

  if (!configuredToken) {
    return NextResponse.json(
      {
        error: {
          code: "CONFIG_ERROR",
          message: "INTERNAL_API_TOKEN is required for protected API routes.",
        },
      },
      {
        status: 500,
        headers: {
          [REQUEST_ID_HEADER]: requestId,
        },
      },
    );
  }

  const providedToken = request.headers.get(INTERNAL_TOKEN_HEADER)?.trim();

  if (!providedToken || providedToken !== configuredToken) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Missing or invalid internal API token.",
        },
      },
      {
        status: 401,
        headers: {
          [REQUEST_ID_HEADER]: requestId,
        },
      },
    );
  }

  if (shouldApplySyncRateLimit(request) && isSyncRateLimited(request)) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many sync requests. Please retry shortly.",
        },
      },
      {
        status: 429,
        headers: {
          [REQUEST_ID_HEADER]: requestId,
        },
      },
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: ["/api/sync/:path*", "/api/settings/:path*"],
};

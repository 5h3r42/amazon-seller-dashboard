export const REQUEST_ID_HEADER = "x-request-id";

export function getRequestId(request: Request): string {
  return request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
}

export function logStructured(message: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      message,
      ...payload,
    }),
  );
}

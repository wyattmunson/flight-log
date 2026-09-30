import type { ApiError as ApiErrorBody } from '@flight-log/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    /** Extra response context: the API path (without `/api`) and the `Retry-After` seconds, if any. */
    public meta: { path?: string; retryAfter?: number } = {},
  ) {
    super(message);
  }

  /** Field-level validation messages keyed by path, when the API returned them. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      (this.details as { path?: string; message?: string }[])
        .filter((d) => d.path)
        .map((d) => [d.path!, d.message ?? 'Invalid']),
    );
  }
}

type Query = Record<string, string | number | undefined | null>;

export function toQueryString(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { query?: Query; json?: unknown } = {},
): Promise<T> {
  const { query, json, headers, ...rest } = init;
  const res = await fetch(`/api${path}${toQueryString(query)}`, {
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'http_error',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
      { path, retryAfter: Number(res.headers.get('retry-after')) || undefined },
    );
  }
  return body as T;
}

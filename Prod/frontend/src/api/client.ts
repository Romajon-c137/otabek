const API_BASE = (window as Window & { __API_BASE__?: string }).__API_BASE__ ?? '/api/v1';
const TOKEN_KEY = 'hozuchet.production.token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId?: string;

  constructor(status: number, message: string, details: unknown, requestId?: string, code = 'request_error') {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
    this.requestId = requestId;
  }
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function saveToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

function requestId(): string {
  return crypto.randomUUID();
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Token ${token}`);
  headers.set('X-Request-ID', requestId());
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = body?.error;
    throw new ApiError(response.status, envelope?.message ?? 'Сервер отклонил запрос.', envelope?.details ?? body, envelope?.request_id, envelope?.code);
  }
  return body as T;
}

export function idempotencyHeaders(): HeadersInit {
  return { 'Idempotency-Key': crypto.randomUUID() };
}

export function queryString(values: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

export async function apiAll<T>(path: string): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  let pages = 1;
  do {
    const separator = path.includes('?') ? '&' : '?';
    const response = await api<{ results: T[]; pages: number }>(`${path}${separator}page_size=200&page=${page}`);
    results.push(...response.results);
    pages = response.pages;
    page += 1;
  } while (page <= pages);
  return results;
}


const TOKEN_KEY = 'eduplanner.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Options = {
  method?: string;
  body?: unknown;
  raw?: Blob | ArrayBuffer;
  contentType?: string;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (options.raw) {
    body = options.raw as BodyInit;
    headers['Content-Type'] = options.contentType || 'application/octet-stream';
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, { method: options.method || (body ? 'POST' : 'GET'), headers, body });
  if (res.status === 204) return undefined as T;
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message = typeof data === 'object' && data && 'message' in data ? String((data as { message: string }).message) : 'Anfrage fehlgeschlagen.';
    throw new ApiError(res.status, (data as { error?: string })?.error || 'error', message);
  }
  return data as T;
}

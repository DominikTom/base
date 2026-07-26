'use client';

/** Fetch helpery klienta — spójna obsługa błędów (polskie komunikaty z API). */

export class StudioApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'StudioApiError';
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new StudioApiError(json.error ?? `Błąd serwera (${res.status})`, res.status);
  }
  return json;
}

export async function apiGet<T>(url: string): Promise<T> {
  return parseResponse<T>(await fetch(url, { cache: 'no-store' }));
}

export async function apiJson<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown
): Promise<T> {
  return parseResponse<T>(
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export async function apiForm<T>(url: string, form: FormData): Promise<T> {
  return parseResponse<T>(await fetch(url, { method: 'POST', body: form }));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

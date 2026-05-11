import { getSupabaseAdmin } from '@/lib/supabase';

type SyncKind = 'realtime' | 'historical' | 'sensor_list';

class SensMaxHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function logSyncEvent(input: {
  kind: SyncKind;
  serial?: string;
  status: 'ok' | 'rate_limited' | 'http_error' | 'parse_error';
  httpStatus?: number;
  message?: string;
  durationMs?: number;
}) {
  await getSupabaseAdmin().from('sensmax_sync_log').insert({
    kind: input.kind,
    serial: input.serial ?? null,
    status: input.status,
    http_status: input.httpStatus ?? null,
    message: input.message ?? null,
    duration_ms: input.durationMs ?? null,
  });
}

export async function fetchSensMax<T>(path: string, kind: SyncKind, serial?: string): Promise<T> {
  const baseUrl = process.env.SENSMAX_BASE_URL;
  const apiKey = process.env.SENSMAX_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error('Missing SENSMAX_BASE_URL or SENSMAX_API_KEY');
  }

  const url = `${baseUrl}${path}`;
  const retries = [0, 2000, 5000];
  const started = Date.now();

  for (let attempt = 0; attempt < retries.length; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, retries[attempt]));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(url, {
        headers: { apikey: apiKey },
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!response.ok) {
        const body = await response.text();
        if (response.status === 429) {
          await logSyncEvent({ kind, serial, status: 'rate_limited', httpStatus: 429, message: body, durationMs: Date.now() - started });
          throw new SensMaxHttpError(`Rate limited: ${body}`, 429);
        }
        if (response.status >= 500 && attempt < retries.length - 1) {
          continue;
        }
        await logSyncEvent({ kind, serial, status: 'http_error', httpStatus: response.status, message: body, durationMs: Date.now() - started });
        throw new SensMaxHttpError(`HTTP ${response.status}: ${body}`, response.status);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const rawBody = await response.text();

      if (!contentType.toLowerCase().includes('application/json')) {
        const snippet = rawBody.slice(0, 200);
        const message = `Expected JSON from SensMax but got '${contentType || 'unknown'}'. Body starts with: ${snippet}`;
        await logSyncEvent({ kind, serial, status: 'parse_error', httpStatus: response.status, message, durationMs: Date.now() - started });
        throw new SensMaxHttpError(message, response.status);
      }

      let data: T;
      try {
        data = JSON.parse(rawBody) as T;
      } catch {
        const snippet = rawBody.slice(0, 200);
        const message = `Invalid JSON from SensMax. Body starts with: ${snippet}`;
        await logSyncEvent({ kind, serial, status: 'parse_error', httpStatus: response.status, message, durationMs: Date.now() - started });
        throw new SensMaxHttpError(message, response.status);
      }

      await logSyncEvent({ kind, serial, status: 'ok', durationMs: Date.now() - started });
      return data;
    } catch (error) {
      if (error instanceof SensMaxHttpError) throw error;
      if (attempt < retries.length - 1) continue;
      await logSyncEvent({
        kind,
        serial,
        status: 'parse_error',
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Unexpected SensMax fetch control flow');
}

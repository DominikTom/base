import { getSupabaseAdmin } from '@/lib/supabase';

type SyncKind = 'today' | 'historical' | 'sensor_list' | 'group_list';

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
  try {
    await getSupabaseAdmin().from('sensmax_sync_log').insert({
      kind: input.kind,
      serial: input.serial ?? null,
      status: input.status,
      http_status: input.httpStatus ?? null,
      message: input.message ?? null,
      duration_ms: input.durationMs ?? null,
    });
  } catch {
    /* best-effort logging */
  }
}

interface FetchOpts {
  serial?: string;
  /** Use Next data cache with this TTL (seconds) instead of no-store. */
  revalidateSec?: number;
  /** Write a row to sensmax_sync_log for the outcome (default true). */
  log?: boolean;
}

export async function fetchSensMax<T>(path: string, kind: SyncKind, opts: FetchOpts = {}): Promise<T> {
  const { serial, revalidateSec, log = true } = opts;
  const baseUrl = process.env.SENSMAX_BASE_URL || 'https://my.sensmax.eu/api/v2';
  const apiKey = process.env.SENSMAX_API_KEY;

  if (!apiKey) {
    throw new Error('Missing SENSMAX_API_KEY');
  }

  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  const retries = [0, 2000, 5000];
  const started = Date.now();
  const maybeLog = (event: Parameters<typeof logSyncEvent>[0]) => {
    if (log) return logSyncEvent(event);
    return Promise.resolve();
  };

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
        ...(revalidateSec ? { next: { revalidate: revalidateSec } } : { cache: 'no-store' as RequestCache }),
      });

      if (!response.ok) {
        const body = await response.text();
        if (response.status === 429) {
          await maybeLog({ kind, serial, status: 'rate_limited', httpStatus: 429, message: body.slice(0, 500), durationMs: Date.now() - started });
          throw new SensMaxHttpError(`Rate limited: ${body.slice(0, 200)}`, 429);
        }
        if (response.status >= 500 && attempt < retries.length - 1) {
          continue;
        }
        await maybeLog({ kind, serial, status: 'http_error', httpStatus: response.status, message: body.slice(0, 500), durationMs: Date.now() - started });
        throw new SensMaxHttpError(`HTTP ${response.status}: ${body.slice(0, 200)}`, response.status);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const rawBody = await response.text();

      if (!contentType.toLowerCase().includes('application/json')) {
        const message = `Expected JSON from SensMax but got '${contentType || 'unknown'}'. Body: ${rawBody.slice(0, 200)}`;
        await maybeLog({ kind, serial, status: 'parse_error', httpStatus: response.status, message, durationMs: Date.now() - started });
        throw new SensMaxHttpError(message, response.status);
      }

      let data: T;
      try {
        data = JSON.parse(rawBody) as T;
      } catch {
        const message = `Invalid JSON from SensMax. Body: ${rawBody.slice(0, 200)}`;
        await maybeLog({ kind, serial, status: 'parse_error', httpStatus: response.status, message, durationMs: Date.now() - started });
        throw new SensMaxHttpError(message, response.status);
      }

      await maybeLog({ kind, serial, status: 'ok', durationMs: Date.now() - started });
      return data;
    } catch (error) {
      if (error instanceof SensMaxHttpError) throw error;
      if (attempt < retries.length - 1) continue;
      await maybeLog({
        kind,
        serial,
        status: 'parse_error',
        message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        durationMs: Date.now() - started,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Unexpected SensMax fetch control flow');
}

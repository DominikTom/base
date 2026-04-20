// Thulium (contact center) API client.
// Docs live behind tenant login at {tenant}.thulium.com/docs/api.
// Auth: HTTP Basic with login/password created in Admin → API parameters.
// We only read data here — writes (hangup, pause, etc.) are intentionally not exposed.

const THULIUM_TIMEOUT_MS = 15000;

function getConfig() {
  const baseUrl = process.env.THULIUM_API_BASE_URL;
  const user = process.env.THULIUM_API_USER;
  const pass = process.env.THULIUM_API_PASS;
  if (!baseUrl) throw new Error('THULIUM_API_BASE_URL env var is not set');
  if (!user || !pass) throw new Error('THULIUM_API_USER / THULIUM_API_PASS env vars are not set');
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    authHeader: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
  };
}

export function isThuliumConfigured(): boolean {
  return Boolean(
    process.env.THULIUM_API_BASE_URL &&
    process.env.THULIUM_API_USER &&
    process.env.THULIUM_API_PASS
  );
}

async function thuliumFetch<T = unknown>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const { baseUrl, authHeader } = getConfig();
  const qs = params
    ? '?' + Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const url = `${baseUrl}/${path.replace(/^\/+/, '')}${qs}`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(THULIUM_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Thulium API ${res.status} on ${path}: ${text.slice(0, 500)}`);
  }
  return res.json() as Promise<T>;
}

// Thulium responses come in a few shapes: raw array, { data: [...] }, or
// { items: [...] }. This normalizer handles all three.
function asArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.results)) return obj.results as T[];
  }
  return [];
}

// Generic paginated fetch: walks `page=1..N` until an empty page comes back.
async function paginate<T>(path: string, baseParams: Record<string, string | number | undefined> = {}, pageSize = 200): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 200; page++) {
    const payload = await thuliumFetch<unknown>(path, { ...baseParams, page, per_page: pageSize });
    const chunk = asArray<T>(payload);
    if (chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return out;
}

// ============ Types (loose — Thulium payloads vary by tenant) ============

export interface ThuliumQueue {
  id: string | number;
  name?: string;
}

export interface ThuliumQueueWaitingStats {
  waiting?: number;
  estimated_waiting_time?: number;
  estimated_wait_time?: number;
}

export interface ThuliumAgent {
  login: string;
  name?: string;
  email?: string;
  groups?: Array<string | { name?: string }>;
}

export interface ThuliumAgentStatus {
  login: string;
  status?: string;
  since?: string;
  pause_reason?: string;
}

export interface ThuliumConnection {
  id: string | number;
  direction?: string;               // 'in' | 'out' | 'incoming' | 'outgoing'
  type?: string;
  queue_id?: string | number;
  queue_name?: string;
  queue?: string | { id?: string | number; name?: string };
  agent?: string | { login?: string; name?: string };
  agent_login?: string;
  start?: string;
  start_time?: string;
  started_at?: string;
  wait_time?: number | string;
  waiting_time?: number | string;
  talk_time?: number | string;
  duration?: number | string;
  billing_time?: number | string;
  status?: string;
  result?: string;
  answered?: boolean;
  abandoned?: boolean;
}

export interface ThuliumAgentWorkRow {
  login?: string;
  agent_login?: string;
  agent?: string;
  date?: string;
  logged_time?: number | string;
  login_time?: number | string;
  talk_time?: number | string;
  pause_time?: number | string;
  calls?: number | string;
  calls_handled?: number | string;
}

export interface ThuliumTicket {
  id: string | number;
  created_at?: string;
  created?: string;
  resolved_at?: string;
  closed_at?: string;
  first_response_at?: string;
  status?: string | { name?: string };
  category?: string | { name?: string };
  queue?: string | { id?: string | number; name?: string };
  queue_id?: string | number;
  queue_name?: string;
  agent?: string | { login?: string };
  agent_login?: string;
  sla_breached?: boolean;
}

export interface ThuliumChatSummaryRow {
  date?: string;
  queue_id?: string | number;
  queue?: string | { id?: string | number; name?: string };
  queue_name?: string;
  conversations?: number;
  count?: number;
  avg_response_time?: number;
  avg_response_seconds?: number;
}

export interface ThuliumOutbound {
  id: string | number;
  name?: string;
}

export interface ThuliumOutboundStatsRow {
  id?: string | number;
  outbound_id?: string | number;
  name?: string;
  records_done?: number;
  records_todo?: number;
  done?: number;
  todo?: number;
}

// ============ Read helpers (normalized return values) ============

export async function listQueues(): Promise<ThuliumQueue[]> {
  return asArray<ThuliumQueue>(await thuliumFetch('queues'));
}

export async function getQueueWaitingStats(id: string | number): Promise<ThuliumQueueWaitingStats> {
  const payload = await thuliumFetch<unknown>(`queues/${id}/waiting_stats`);
  if (payload && typeof payload === 'object') return payload as ThuliumQueueWaitingStats;
  return {};
}

export async function listAgents(): Promise<ThuliumAgent[]> {
  return asArray<ThuliumAgent>(await thuliumFetch('agents'));
}

export async function getAgentsStatuses(): Promise<ThuliumAgentStatus[]> {
  return asArray<ThuliumAgentStatus>(await thuliumFetch('agents_statuses'));
}

export async function listConnections(params: { dateFrom: string; dateTo: string }): Promise<ThuliumConnection[]> {
  return paginate<ThuliumConnection>('connections', {
    date_from: params.dateFrom,
    date_to: params.dateTo,
  });
}

export async function getAgentsWorkReport(params: { dateFrom: string; dateTo: string }): Promise<ThuliumAgentWorkRow[]> {
  return asArray<ThuliumAgentWorkRow>(await thuliumFetch('agents_work_report', {
    date_from: params.dateFrom,
    date_to: params.dateTo,
  }));
}

export async function listTickets(params: { dateFrom: string; dateTo: string }): Promise<ThuliumTicket[]> {
  return paginate<ThuliumTicket>('tickets', {
    date_from: params.dateFrom,
    date_to: params.dateTo,
  });
}

export async function getTicketStatuses(): Promise<Array<{ id?: string | number; name?: string }>> {
  return asArray(await thuliumFetch('ticket_statuses'));
}

export async function getTicketCategories(): Promise<Array<{ id?: string | number; name?: string }>> {
  return asArray(await thuliumFetch('ticket_categories'));
}

export async function getTicketQueues(): Promise<Array<{ id?: string | number; name?: string }>> {
  return asArray(await thuliumFetch('ticket_queues'));
}

export async function getChatsSummary(params: { dateFrom: string; dateTo: string }): Promise<ThuliumChatSummaryRow[]> {
  return asArray<ThuliumChatSummaryRow>(await thuliumFetch('chats/reports/summary', {
    date_from: params.dateFrom,
    date_to: params.dateTo,
  }));
}

export async function listOutbounds(): Promise<ThuliumOutbound[]> {
  return asArray<ThuliumOutbound>(await thuliumFetch('outbounds'));
}

export async function getOutboundsStats(): Promise<ThuliumOutboundStatsRow[]> {
  return asArray<ThuliumOutboundStatsRow>(await thuliumFetch('outbounds/stats'));
}

// ============ Field extractors (defensive against varying payloads) ============

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function extractConnectionFields(c: ThuliumConnection): {
  id: string;
  direction: 'in' | 'out';
  queueId: string | null;
  queueName: string | null;
  agentLogin: string | null;
  startAt: string | null;
  date: string | null;
  waitSeconds: number;
  talkSeconds: number;
  result: 'answered' | 'abandoned' | 'missed';
} {
  const id = String(c.id);
  const dirRaw = (c.direction || c.type || '').toString().toLowerCase();
  const direction: 'in' | 'out' = dirRaw.startsWith('out') ? 'out' : 'in';

  let queueId: string | null = null;
  let queueName: string | null = null;
  if (c.queue_id !== undefined) queueId = String(c.queue_id);
  if (c.queue_name) queueName = c.queue_name;
  if (c.queue) {
    if (typeof c.queue === 'string') queueName = queueName || c.queue;
    else {
      if (c.queue.id !== undefined) queueId = queueId || String(c.queue.id);
      queueName = queueName || str(c.queue.name) || null;
    }
  }

  let agentLogin: string | null = c.agent_login || null;
  if (!agentLogin && c.agent) {
    if (typeof c.agent === 'string') agentLogin = c.agent;
    else agentLogin = str(c.agent.login) || null;
  }

  const startAt = c.start || c.start_time || c.started_at || null;
  const date = startAt ? startAt.slice(0, 10) : null;

  const waitSeconds = Math.round(num(c.wait_time ?? c.waiting_time));
  const talkSeconds = Math.round(num(c.talk_time ?? c.duration ?? c.billing_time));

  const statusRaw = (c.result || c.status || '').toString().toLowerCase();
  let result: 'answered' | 'abandoned' | 'missed' = 'answered';
  if (c.abandoned || statusRaw.includes('abandon')) result = 'abandoned';
  else if (c.answered === false || statusRaw.includes('miss') || statusRaw.includes('noanswer') || statusRaw.includes('no_answer')) result = 'missed';
  else if (statusRaw.includes('answer')) result = 'answered';
  else if (talkSeconds === 0 && waitSeconds > 0) result = direction === 'in' ? 'missed' : 'answered';

  return { id, direction, queueId, queueName, agentLogin, startAt, date, waitSeconds, talkSeconds, result };
}

export function extractAgentWorkFields(r: ThuliumAgentWorkRow): {
  date: string | null;
  agentLogin: string | null;
  loggedSeconds: number;
  talkSeconds: number;
  pauseSeconds: number;
  callsHandled: number;
} {
  const date = r.date ? r.date.slice(0, 10) : null;
  const agentLogin = r.agent_login || r.login || r.agent || null;
  return {
    date,
    agentLogin,
    loggedSeconds: Math.round(num(r.logged_time ?? r.login_time)),
    talkSeconds: Math.round(num(r.talk_time)),
    pauseSeconds: Math.round(num(r.pause_time)),
    callsHandled: Math.round(num(r.calls ?? r.calls_handled)),
  };
}

export function extractTicketFields(t: ThuliumTicket): {
  id: string;
  createdAt: string | null;
  resolvedAt: string | null;
  firstResponseAt: string | null;
  status: string | null;
  category: string | null;
  queueId: string | null;
  queueName: string | null;
  agentLogin: string | null;
  slaBreached: boolean;
} {
  const id = String(t.id);
  const status = typeof t.status === 'string' ? t.status : str(t.status?.name) || null;
  const category = typeof t.category === 'string' ? t.category : str(t.category?.name) || null;

  let queueId: string | null = t.queue_id !== undefined ? String(t.queue_id) : null;
  let queueName: string | null = t.queue_name || null;
  if (t.queue) {
    if (typeof t.queue === 'string') queueName = queueName || t.queue;
    else {
      if (t.queue.id !== undefined) queueId = queueId || String(t.queue.id);
      queueName = queueName || str(t.queue.name) || null;
    }
  }

  let agentLogin: string | null = t.agent_login || null;
  if (!agentLogin && t.agent) {
    if (typeof t.agent === 'string') agentLogin = t.agent;
    else agentLogin = str(t.agent.login) || null;
  }

  return {
    id,
    createdAt: t.created_at || t.created || null,
    resolvedAt: t.resolved_at || t.closed_at || null,
    firstResponseAt: t.first_response_at || null,
    status,
    category,
    queueId,
    queueName,
    agentLogin,
    slaBreached: Boolean(t.sla_breached),
  };
}

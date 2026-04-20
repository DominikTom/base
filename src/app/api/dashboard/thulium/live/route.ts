import { NextResponse } from 'next/server';
import {
  isThuliumConfigured,
  listQueues,
  getQueueWaitingStats,
  listAgents,
  getAgentsStatuses,
} from '@/lib/thulium';

export const revalidate = 0;

// Small in-memory cache to absorb bursts when multiple browser tabs poll /live.
const CACHE_TTL_MS = 20_000;
let cache: { at: number; payload: unknown } | null = null;

export async function GET() {
  if (!isThuliumConfigured()) {
    return NextResponse.json({ error: 'Thulium not configured' }, { status: 503 });
  }

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }

  try {
    const [queues, agents, agentStatuses] = await Promise.all([
      listQueues(),
      listAgents(),
      getAgentsStatuses(),
    ]);

    const queueStats = await Promise.all(
      queues.map(async q => {
        try {
          const stats = await getQueueWaitingStats(q.id);
          const waiting = Number(stats.waiting ?? 0);
          const etaRaw = stats.estimated_waiting_time ?? stats.estimated_wait_time ?? 0;
          const eta = Number(etaRaw);
          return {
            id: String(q.id),
            name: q.name || String(q.id),
            waiting: Number.isFinite(waiting) ? waiting : 0,
            etaSeconds: Number.isFinite(eta) ? Math.round(eta) : 0,
          };
        } catch {
          return { id: String(q.id), name: q.name || String(q.id), waiting: 0, etaSeconds: 0 };
        }
      })
    );

    // Agents: bucket by status
    const statusByLogin: Record<string, string> = {};
    for (const s of agentStatuses) {
      if (s.login) statusByLogin[s.login] = (s.status || '').toLowerCase();
    }
    const buckets = { online: 0, talking: 0, paused: 0, offline: 0 };
    const agentList = agents.map(a => {
      const raw = statusByLogin[a.login] || 'offline';
      let bucket: 'online' | 'talking' | 'paused' | 'offline' = 'offline';
      if (raw.includes('talk') || raw.includes('call') || raw.includes('rozmow')) bucket = 'talking';
      else if (raw.includes('paus') || raw.includes('break')) bucket = 'paused';
      else if (raw.includes('free') || raw.includes('ready') || raw.includes('wolny') || raw.includes('online') || raw === 'logged_in') bucket = 'online';
      else if (raw) bucket = 'online';
      buckets[bucket]++;
      return { login: a.login, name: a.name || a.login, status: raw || 'offline', bucket };
    });

    const totalWaiting = queueStats.reduce((s, q) => s + q.waiting, 0);
    const maxEta = queueStats.reduce((m, q) => Math.max(m, q.etaSeconds), 0);

    const payload = {
      fetchedAt: new Date().toISOString(),
      summary: {
        totalWaiting,
        maxEtaSeconds: maxEta,
        online: buckets.online,
        talking: buckets.talking,
        paused: buckets.paused,
        offline: buckets.offline,
      },
      queues: queueStats.sort((a, b) => b.waiting - a.waiting),
      agents: agentList.sort((a, b) => a.login.localeCompare(b.login)),
    };

    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (err) {
    console.error('Thulium live API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

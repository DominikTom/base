import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

interface ConnRow {
  date: string;
  direction: string;
  queue_id: string | null;
  queue_name: string | null;
  agent_login: string | null;
  wait_seconds: number;
  talk_seconds: number;
  result: string;
  answered_in_sla: boolean;
}

interface TicketRow {
  ticket_id: string;
  created_at: string;
  resolved_at: string | null;
  first_response_at: string | null;
  status: string | null;
  category: string | null;
  queue_name: string | null;
  sla_breached: boolean;
}

interface AgentWorkRow {
  date: string;
  agent_login: string;
  logged_seconds: number;
  talk_seconds: number;
  pause_seconds: number;
  calls_handled: number;
}

interface ChatRow {
  date: string;
  queue_id: string;
  queue_name: string | null;
  conversations: number;
  avg_response_seconds: number | null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const dateTo = searchParams.get('date_to') || new Date().toISOString().slice(0, 10);

    const db = getSupabaseAdmin();

    const [connRes, ticketRes, workRes, chatRes] = await Promise.all([
      db.from('fact_thulium_connections')
        .select('date, direction, queue_id, queue_name, agent_login, wait_seconds, talk_seconds, result, answered_in_sla')
        .gte('date', dateFrom).lte('date', dateTo).limit(50000),
      db.from('fact_thulium_tickets')
        .select('ticket_id, created_at, resolved_at, first_response_at, status, category, queue_name, sla_breached')
        .gte('created_at', `${dateFrom}T00:00:00Z`).lte('created_at', `${dateTo}T23:59:59Z`).limit(20000),
      db.from('fact_thulium_agent_work_daily')
        .select('date, agent_login, logged_seconds, talk_seconds, pause_seconds, calls_handled')
        .gte('date', dateFrom).lte('date', dateTo).limit(20000),
      db.from('fact_thulium_chats_daily')
        .select('date, queue_id, queue_name, conversations, avg_response_seconds')
        .gte('date', dateFrom).lte('date', dateTo).limit(20000),
    ]);

    const connections: ConnRow[] = connRes.data || [];
    const tickets: TicketRow[] = ticketRes.data || [];
    const work: AgentWorkRow[] = workRes.data || [];
    const chats: ChatRow[] = chatRes.data || [];

    // ========== CALLS ==========
    const callsKpi = {
      inbound: 0,
      outbound: 0,
      answered: 0,
      missed: 0,
      abandoned: 0,
      waitTotal: 0,
      waitAnsweredCount: 0,
      talkTotal: 0,
      talkAnsweredCount: 0,
      answeredInSla: 0,
    };
    for (const c of connections) {
      if (c.direction === 'in') callsKpi.inbound++;
      else callsKpi.outbound++;
      if (c.result === 'answered') {
        callsKpi.answered++;
        callsKpi.waitTotal += c.wait_seconds || 0;
        callsKpi.waitAnsweredCount++;
        callsKpi.talkTotal += c.talk_seconds || 0;
        callsKpi.talkAnsweredCount++;
        if (c.answered_in_sla) callsKpi.answeredInSla++;
      } else if (c.result === 'missed') {
        callsKpi.missed++;
      } else if (c.result === 'abandoned') {
        callsKpi.abandoned++;
      }
    }
    const totalInbound = callsKpi.inbound;
    const serviceLevel = totalInbound > 0 ? (callsKpi.answeredInSla / totalInbound) * 100 : 0;
    const asa = callsKpi.waitAnsweredCount > 0 ? callsKpi.waitTotal / callsKpi.waitAnsweredCount : 0;
    const aht = callsKpi.talkAnsweredCount > 0 ? callsKpi.talkTotal / callsKpi.talkAnsweredCount : 0;
    const abandonRate = totalInbound > 0 ? (callsKpi.abandoned / totalInbound) * 100 : 0;
    const answeredRate = totalInbound > 0 ? (callsKpi.answered / totalInbound) * 100 : 0;

    // Calls over time
    const callsByDay: Record<string, { inbound: number; outbound: number; answered: number; missed: number; abandoned: number }> = {};
    for (const c of connections) {
      if (!callsByDay[c.date]) callsByDay[c.date] = { inbound: 0, outbound: 0, answered: 0, missed: 0, abandoned: 0 };
      const b = callsByDay[c.date];
      if (c.direction === 'in') b.inbound++; else b.outbound++;
      if (c.result === 'answered') b.answered++;
      else if (c.result === 'missed') b.missed++;
      else if (c.result === 'abandoned') b.abandoned++;
    }
    const callsTimeline = Object.entries(callsByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    // Calls per queue
    const callsByQueue: Record<string, number> = {};
    for (const c of connections) {
      const key = c.queue_name || c.queue_id || '—';
      callsByQueue[key] = (callsByQueue[key] || 0) + 1;
    }
    const callsPerQueue = Object.entries(callsByQueue)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // Wait time distribution (buckets in seconds)
    const waitBuckets = [
      { name: '0–10s', min: 0, max: 10, value: 0 },
      { name: '10–20s', min: 10, max: 20, value: 0 },
      { name: '20–40s', min: 20, max: 40, value: 0 },
      { name: '40–60s', min: 40, max: 60, value: 0 },
      { name: '60s+', min: 60, max: Infinity, value: 0 },
    ];
    for (const c of connections) {
      if (c.result !== 'answered') continue;
      const w = c.wait_seconds || 0;
      const b = waitBuckets.find(x => w >= x.min && w < x.max);
      if (b) b.value++;
    }

    // ========== TICKETS ==========
    const now = Date.now();
    const ticketKpi = {
      total: tickets.length,
      open: 0,
      closed: 0,
      overdue: 0,
      firstResponseTotal: 0,
      firstResponseCount: 0,
      resolveTotal: 0,
      resolveCount: 0,
    };
    const ticketByStatus: Record<string, number> = {};
    const ticketByCategory: Record<string, number> = {};
    const ticketByQueue: Record<string, number> = {};

    for (const t of tickets) {
      const statusKey = (t.status || '—').toLowerCase();
      ticketByStatus[t.status || '—'] = (ticketByStatus[t.status || '—'] || 0) + 1;
      ticketByCategory[t.category || '—'] = (ticketByCategory[t.category || '—'] || 0) + 1;
      ticketByQueue[t.queue_name || '—'] = (ticketByQueue[t.queue_name || '—'] || 0) + 1;

      const isClosed = statusKey.includes('close') || statusKey.includes('resolve') || statusKey.includes('zamkn') || Boolean(t.resolved_at);
      if (isClosed) ticketKpi.closed++;
      else ticketKpi.open++;

      if (t.sla_breached) ticketKpi.overdue++;
      else if (!isClosed) {
        // fallback: open >48h counts as overdue
        const ageHours = (now - new Date(t.created_at).getTime()) / 3600000;
        if (ageHours > 48) ticketKpi.overdue++;
      }

      if (t.first_response_at) {
        const d = (new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()) / 1000;
        if (d >= 0) { ticketKpi.firstResponseTotal += d; ticketKpi.firstResponseCount++; }
      }
      if (t.resolved_at) {
        const d = (new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime()) / 1000;
        if (d >= 0) { ticketKpi.resolveTotal += d; ticketKpi.resolveCount++; }
      }
    }
    const avgFrt = ticketKpi.firstResponseCount > 0 ? ticketKpi.firstResponseTotal / ticketKpi.firstResponseCount : 0;
    const avgTtr = ticketKpi.resolveCount > 0 ? ticketKpi.resolveTotal / ticketKpi.resolveCount : 0;

    const ticketByStatusArr = Object.entries(ticketByStatus).map(([name, value]) => ({ name, value }));
    const ticketByCategoryArr = Object.entries(ticketByCategory)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const ticketByQueueArr = Object.entries(ticketByQueue)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // ========== CHATS ==========
    let chatConversations = 0;
    let chatRespTotal = 0;
    let chatRespDays = 0;
    const chatByDay: Record<string, number> = {};
    for (const c of chats) {
      chatConversations += c.conversations || 0;
      if (c.avg_response_seconds != null) { chatRespTotal += c.avg_response_seconds; chatRespDays++; }
      chatByDay[c.date] = (chatByDay[c.date] || 0) + (c.conversations || 0);
    }
    const chatKpi = {
      conversations: chatConversations,
      avgResponseSeconds: chatRespDays > 0 ? Math.round(chatRespTotal / chatRespDays) : 0,
    };
    const chatTimeline = Object.entries(chatByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ name: date, value }));

    // ========== AGENTS ==========
    type AgentAgg = { agent_login: string; logged: number; talk: number; pause: number; calls: number };
    const agentAgg: Record<string, AgentAgg> = {};
    for (const w of work) {
      const a = agentAgg[w.agent_login] ||= { agent_login: w.agent_login, logged: 0, talk: 0, pause: 0, calls: 0 };
      a.logged += w.logged_seconds || 0;
      a.talk += w.talk_seconds || 0;
      a.pause += w.pause_seconds || 0;
      a.calls += w.calls_handled || 0;
    }
    const agents = Object.values(agentAgg).map(a => {
      const occupied = a.logged > 0 ? (a.talk / a.logged) * 100 : 0;
      return {
        agent_login: a.agent_login,
        logged_hours: Math.round((a.logged / 3600) * 10) / 10,
        talk_hours: Math.round((a.talk / 3600) * 10) / 10,
        pause_hours: Math.round((a.pause / 3600) * 10) / 10,
        calls: a.calls,
        occupancy: Math.round(occupied * 10) / 10,
      };
    }).sort((a, b) => b.calls - a.calls);

    const topAgents = agents.slice(0, 5).map(a => ({ name: a.agent_login, value: a.calls }));

    return NextResponse.json({
      calls: {
        kpis: {
          inbound: callsKpi.inbound,
          outbound: callsKpi.outbound,
          answered: callsKpi.answered,
          missed: callsKpi.missed,
          abandoned: callsKpi.abandoned,
          answeredRate: Math.round(answeredRate * 10) / 10,
          serviceLevel: Math.round(serviceLevel * 10) / 10,
          asa: Math.round(asa),
          aht: Math.round(aht),
          abandonRate: Math.round(abandonRate * 10) / 10,
        },
        timeline: callsTimeline,
        perQueue: callsPerQueue,
        waitBuckets: waitBuckets.map(({ name, value }) => ({ name, value })),
      },
      tickets: {
        kpis: {
          total: ticketKpi.total,
          open: ticketKpi.open,
          closed: ticketKpi.closed,
          overdue: ticketKpi.overdue,
          avgFrtSeconds: Math.round(avgFrt),
          avgTtrSeconds: Math.round(avgTtr),
        },
        byStatus: ticketByStatusArr,
        byCategory: ticketByCategoryArr,
        byQueue: ticketByQueueArr,
      },
      chats: {
        kpis: chatKpi,
        timeline: chatTimeline,
      },
      agents: {
        table: agents,
        topByCalls: topAgents,
      },
      range: { from: dateFrom, to: dateTo },
    });
  } catch (err) {
    console.error('Thulium dashboard API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

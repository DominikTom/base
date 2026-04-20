import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  isThuliumConfigured,
  listConnections,
  getAgentsWorkReport,
  listTickets,
  getChatsSummary,
  listOutbounds,
  getOutboundsStats,
  extractConnectionFields,
  extractAgentWorkFields,
  extractTicketFields,
} from '@/lib/thulium';

export const maxDuration = 60;

// Service Level threshold: answered within N seconds counts as "in SLA".
const SLA_ANSWER_SECONDS = 20;

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '30', 10);
  return syncThulium(Number.isFinite(days) && days > 0 ? days : 30);
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const cronSecret = process.env.ETL_CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return syncThulium(7);
}

async function syncThulium(daysBack: number) {
  if (!isThuliumConfigured()) {
    return NextResponse.json({
      error: 'Thulium not configured. Set THULIUM_API_BASE_URL, THULIUM_API_USER, THULIUM_API_PASS.',
    }, { status: 500 });
  }

  const db = getSupabaseAdmin();

  const { data: etlLog } = await db
    .from('etl_log')
    .insert({ source: 'thulium', started_at: new Date().toISOString(), status: 'running' })
    .select('id')
    .single();
  const etlLogId = etlLog?.id;

  try {
    const today = new Date();
    const dateTo = new Date(today);
    const dateFrom = new Date(today);
    dateFrom.setDate(dateFrom.getDate() - daysBack);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const dateFromStr = fmt(dateFrom);
    const dateToStr = fmt(dateTo);

    const totals = {
      connections: 0,
      agentWork: 0,
      tickets: 0,
      chats: 0,
      outbound: 0,
    };

    // 1) Connections ------------------------------------------------------
    try {
      const conns = await listConnections({ dateFrom: dateFromStr, dateTo: dateToStr });
      const rows = conns
        .map(extractConnectionFields)
        .filter(c => c.date)
        .map(c => ({
          connection_id: c.id,
          date: c.date!,
          direction: c.direction,
          queue_id: c.queueId,
          queue_name: c.queueName,
          agent_login: c.agentLogin,
          start_at: c.startAt,
          wait_seconds: c.waitSeconds,
          talk_seconds: c.talkSeconds,
          result: c.result,
          answered_in_sla: c.result === 'answered' && c.waitSeconds <= SLA_ANSWER_SECONDS,
        }));

      await db.from('fact_thulium_connections').delete()
        .gte('date', dateFromStr).lte('date', dateToStr);

      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from('fact_thulium_connections')
          .upsert(rows.slice(i, i + 500), { onConflict: 'connection_id' });
        if (error) throw new Error(`connections upsert: ${error.message}`);
      }
      totals.connections = rows.length;
    } catch (err) {
      console.error('Thulium connections sync error:', err);
    }

    // 2) Agent work report ------------------------------------------------
    try {
      const workRows = await getAgentsWorkReport({ dateFrom: dateFromStr, dateTo: dateToStr });
      const rows = workRows
        .map(extractAgentWorkFields)
        .filter(r => r.date && r.agentLogin)
        .map(r => ({
          date: r.date!,
          agent_login: r.agentLogin!,
          logged_seconds: r.loggedSeconds,
          talk_seconds: r.talkSeconds,
          pause_seconds: r.pauseSeconds,
          calls_handled: r.callsHandled,
        }));

      await db.from('fact_thulium_agent_work_daily').delete()
        .gte('date', dateFromStr).lte('date', dateToStr);

      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from('fact_thulium_agent_work_daily')
          .upsert(rows.slice(i, i + 500), { onConflict: 'date,agent_login' });
        if (error) throw new Error(`agent_work upsert: ${error.message}`);
      }
      totals.agentWork = rows.length;
    } catch (err) {
      console.error('Thulium agent work sync error:', err);
    }

    // 3) Tickets ----------------------------------------------------------
    try {
      const tickets = await listTickets({ dateFrom: dateFromStr, dateTo: dateToStr });
      const rows = tickets
        .map(extractTicketFields)
        .filter(t => t.createdAt)
        .map(t => ({
          ticket_id: t.id,
          created_at: t.createdAt!,
          resolved_at: t.resolvedAt,
          first_response_at: t.firstResponseAt,
          status: t.status,
          category: t.category,
          queue_id: t.queueId,
          queue_name: t.queueName,
          agent_login: t.agentLogin,
          sla_breached: t.slaBreached,
        }));

      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from('fact_thulium_tickets')
          .upsert(rows.slice(i, i + 500), { onConflict: 'ticket_id' });
        if (error) throw new Error(`tickets upsert: ${error.message}`);
      }
      totals.tickets = rows.length;
    } catch (err) {
      console.error('Thulium tickets sync error:', err);
    }

    // 4) Chats summary ----------------------------------------------------
    try {
      const chatRows = await getChatsSummary({ dateFrom: dateFromStr, dateTo: dateToStr });
      const rows = chatRows
        .filter(r => r.date)
        .map(r => {
          let queueId: string | null = null;
          let queueName: string | null = null;
          if (r.queue_id !== undefined) queueId = String(r.queue_id);
          if (r.queue_name) queueName = r.queue_name;
          if (r.queue) {
            if (typeof r.queue === 'string') queueName = queueName || r.queue;
            else {
              if (r.queue.id !== undefined) queueId = queueId || String(r.queue.id);
              queueName = queueName || r.queue.name || null;
            }
          }
          return {
            date: r.date!.slice(0, 10),
            queue_id: queueId || 'default',
            queue_name: queueName,
            conversations: r.conversations ?? r.count ?? 0,
            avg_response_seconds: Math.round(
              typeof r.avg_response_seconds === 'number' ? r.avg_response_seconds :
              typeof r.avg_response_time === 'number' ? r.avg_response_time : 0
            ),
          };
        });

      await db.from('fact_thulium_chats_daily').delete()
        .gte('date', dateFromStr).lte('date', dateToStr);

      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from('fact_thulium_chats_daily')
          .upsert(rows.slice(i, i + 500), { onConflict: 'date,queue_id' });
        if (error) throw new Error(`chats upsert: ${error.message}`);
      }
      totals.chats = rows.length;
    } catch (err) {
      console.error('Thulium chats sync error:', err);
    }

    // 5) Outbound stats (daily snapshot for today) ------------------------
    try {
      const [outbounds, stats] = await Promise.all([listOutbounds(), getOutboundsStats()]);
      const nameById: Record<string, string> = {};
      for (const o of outbounds) nameById[String(o.id)] = o.name || '';

      const todayStr = dateToStr;
      const rows = stats.map(s => {
        const id = String(s.id ?? s.outbound_id ?? '');
        return {
          date: todayStr,
          outbound_id: id,
          outbound_name: s.name || nameById[id] || null,
          records_done: s.records_done ?? s.done ?? 0,
          records_todo: s.records_todo ?? s.todo ?? 0,
        };
      }).filter(r => r.outbound_id);

      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from('fact_thulium_outbound_daily')
          .upsert(rows.slice(i, i + 500), { onConflict: 'date,outbound_id' });
        if (error) throw new Error(`outbound upsert: ${error.message}`);
      }
      totals.outbound = rows.length;
    } catch (err) {
      console.error('Thulium outbound sync error:', err);
    }

    const totalRows = totals.connections + totals.agentWork + totals.tickets + totals.chats + totals.outbound;

    if (etlLogId) {
      await db.from('etl_log').update({
        status: 'success',
        finished_at: new Date().toISOString(),
        rows_processed: totalRows,
        rows_inserted: totalRows,
        date_range_start: dateFromStr,
        date_range_end: dateToStr,
      }).eq('id', etlLogId);
    }

    return NextResponse.json({
      success: true,
      totalRows,
      breakdown: totals,
      dateRange: { from: dateFromStr, to: dateToStr },
    });
  } catch (err) {
    console.error('Thulium sync error:', err);
    if (etlLogId) {
      await db.from('etl_log').update({
        status: 'error',
        error_message: String(err),
        finished_at: new Date().toISOString(),
      }).eq('id', etlLogId);
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

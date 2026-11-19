import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAuthUser, isAdmin } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { buildSystemPrompt } from '@/lib/assistant/system-prompt';
import { TOOL_DEFINITIONS, runTool, type ToolContext } from '@/lib/assistant/tools';
import type { Artifact, AssistantStep, ChatResponse } from '@/lib/assistant/types';

const MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 8;   // ogranicza koszt pętli tool-calling
const HISTORY_LIMIT = 20;   // ile ostatnich wiadomości doczytać do kontekstu

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY env var is not set');
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await request.json();
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    let conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;
    if (!message) return NextResponse.json({ error: 'Pusta wiadomość' }, { status: 400 });

    const db = getSupabaseAdmin();

    // ── Wątek rozmowy ──
    if (conversationId) {
      const { data: conv } = await db
        .from('ai_conversations')
        .select('id, user_id')
        .eq('id', conversationId)
        .single();
      if (!conv || conv.user_id !== user.id) {
        return NextResponse.json({ error: 'Nie znaleziono rozmowy' }, { status: 404 });
      }
    } else {
      const { data: created, error } = await db
        .from('ai_conversations')
        .insert({ user_id: user.id, title: message.slice(0, 80) })
        .select('id')
        .single();
      if (error || !created) {
        return NextResponse.json({ error: 'Nie udało się utworzyć rozmowy' }, { status: 500 });
      }
      conversationId = created.id as string;
    }

    // ── Historia → proste tury tekstowe (najnowsze HISTORY_LIMIT) ──
    const { data: historyDesc } = await db
      .from('ai_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);

    const messages: Anthropic.MessageParam[] = [];
    for (const row of (historyDesc || []).reverse()) {
      const text = (row.content as { text?: string } | null)?.text;
      if (text) {
        messages.push({ role: row.role === 'assistant' ? 'assistant' : 'user', content: text });
      }
    }
    messages.push({ role: 'user', content: message });

    // ── Kontekst narzędzi ──
    const admin = await isAdmin(supabase, user.id);
    const ctx: ToolContext = { userId: user.id, userEmail: user.email || '', isAdmin: admin };

    const client = getClient();
    const system = buildSystemPrompt(new Date().toISOString().split('T')[0]);

    const artifacts: Artifact[] = [];
    const steps: AssistantStep[] = [];
    let finalText = '';

    // ── Pętla tool-calling ──
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: TOOL_DEFINITIONS,
        messages,
      });

      const texts: string[] = [];
      for (const block of response.content) {
        if (block.type === 'text') texts.push(block.text);
      }
      if (texts.length) finalText = texts.join('\n\n');

      if (response.stop_reason !== 'tool_use') break;

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const outcome = await runTool(block.name, block.input as Record<string, unknown>, ctx);
        if (outcome.artifact) artifacts.push(outcome.artifact);
        if (outcome.step) steps.push(outcome.step);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: outcome.content,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    if (!finalText) {
      finalText = 'Nie udało się dokończyć odpowiedzi (przekroczono limit kroków). Spróbuj zadać pytanie inaczej.';
    }

    // ── Zapis ──
    const meta = { steps };
    await db.from('ai_messages').insert([
      { conversation_id: conversationId, role: 'user', content: { text: message } },
      { conversation_id: conversationId, role: 'assistant', content: { text: finalText, meta }, artifacts },
    ]);
    await db.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);

    const result: ChatResponse = {
      conversationId,
      reply: { role: 'assistant', content: finalText, artifacts, meta },
    };
    return NextResponse.json(result);
  } catch (err) {
    console.error('Assistant chat error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

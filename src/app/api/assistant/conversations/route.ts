import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import type { AnswerMeta, Artifact, ChatMessageDTO, ConversationSummary } from '@/lib/assistant/types';

// GET            → lista rozmów użytkownika
// GET ?id=<uuid> → wiadomości jednej rozmowy
export async function GET(request: NextRequest) {
  try {
    const { user } = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getSupabaseAdmin();
    const id = new URL(request.url).searchParams.get('id');

    if (id) {
      const { data: conv } = await db
        .from('ai_conversations')
        .select('id, user_id, title')
        .eq('id', id)
        .single();
      if (!conv || conv.user_id !== user.id) {
        return NextResponse.json({ error: 'Nie znaleziono rozmowy' }, { status: 404 });
      }
      const { data: rows } = await db
        .from('ai_messages')
        .select('role, content, artifacts, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });
      const messages: ChatMessageDTO[] = (rows || []).map(r => {
        const c = r.content as { text?: string; meta?: AnswerMeta } | null;
        return {
          role: r.role === 'assistant' ? 'assistant' as const : 'user' as const,
          content: c?.text || '',
          artifacts: (r.artifacts as Artifact[] | null) || undefined,
          meta: c?.meta || undefined,
          createdAt: r.created_at as string,
        };
      });
      return NextResponse.json({ conversation: { id: conv.id, title: conv.title }, messages });
    }

    const { data: convs } = await db
      .from('ai_conversations')
      .select('id, title, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(50);
    const conversations: ConversationSummary[] = (convs || []).map(c => ({
      id: c.id as string,
      title: c.title as string | null,
      updatedAt: c.updated_at as string,
    }));
    return NextResponse.json({ conversations });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// DELETE ?id=<uuid> → usuwa rozmowę (kaskadowo wiadomości)
export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getSupabaseAdmin();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Brak id' }, { status: 400 });

    const { data: conv } = await db
      .from('ai_conversations')
      .select('user_id')
      .eq('id', id)
      .single();
    if (!conv || conv.user_id !== user.id) {
      return NextResponse.json({ error: 'Nie znaleziono rozmowy' }, { status: 404 });
    }
    await db.from('ai_conversations').delete().eq('id', id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

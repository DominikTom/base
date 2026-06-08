'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChatThread } from '@/components/assistant/chat-thread';
import { ConversationList } from '@/components/assistant/conversation-list';
import type { ChatMessageDTO, ChatResponse, ConversationSummary } from '@/lib/assistant/types';

export default function ChatPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [loading, setLoading] = useState(false);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/assistant/conversations');
      if (!res.ok) return;
      const json = await res.json();
      setConversations(json.conversations || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  async function selectConversation(id: string) {
    setActiveId(id);
    setMessages([]);
    try {
      const res = await fetch(`/api/assistant/conversations?id=${id}`);
      if (!res.ok) return;
      const json = await res.json();
      setMessages(json.messages || []);
    } catch { /* ignore */ }
  }

  function newConversation() {
    setActiveId(null);
    setMessages([]);
  }

  async function deleteConversation(id: string) {
    try {
      await fetch(`/api/assistant/conversations?id=${id}`, { method: 'DELETE' });
    } catch { /* ignore */ }
    if (activeId === id) newConversation();
    loadConversations();
  }

  async function send(text: string) {
    if (loading) return;
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeId, message: text }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Błąd: ${json.error || `HTTP ${res.status}`}`,
        }]);
        return;
      }
      const data = json as ChatResponse;
      setMessages(prev => [...prev, data.reply]);
      if (!activeId) {
        setActiveId(data.conversationId);
      }
      loadConversations();
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Błąd połączenia: ${String(err)}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] rounded-xl border border-line overflow-hidden bg-bg">
      <aside className="w-60 border-r border-line shrink-0">
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={selectConversation}
          onNew={newConversation}
          onDelete={deleteConversation}
        />
      </aside>
      <main className="flex-1 min-w-0">
        <ChatThread messages={messages} loading={loading} onSend={send} />
      </main>
    </div>
  );
}

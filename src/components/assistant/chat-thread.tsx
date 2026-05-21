'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { ArtifactRenderer } from './artifact-renderer';
import type { ChatMessageDTO } from '@/lib/assistant/types';

interface ChatThreadProps {
  messages: ChatMessageDTO[];
  loading: boolean;
  onSend: (text: string) => void;
}

const SUGGESTIONS = [
  'Jaki był przychód brutto w tym miesiącu wg sklepu?',
  'Pokaż top 10 modeli łóżek po przychodzie.',
  'Porównaj liczbę zamówień miesiąc do miesiąca.',
];

export function ChatThread({ messages, loading, onSend }: ChatThreadProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function submit() {
    const text = input.trim();
    if (!text || loading) return;
    onSend(text);
    setInput('');
  }

  return (
    <div className="flex flex-col h-full">
      {/* Wiadomości */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 flex items-center justify-center">
              <Sparkles size={24} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-200">Asystent AI</h2>
              <p className="text-sm text-zinc-500 mt-1 max-w-md">
                Zadaj pytanie o dane sprzedażowe, marketingowe lub ruch. Mogę też dodać widget na dashboardzie albo KPI.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-md">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  className="text-left text-sm px-3 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={m.role === 'user' ? 'max-w-[80%]' : 'max-w-[90%] w-full'}>
              <div
                className={
                  m.role === 'user'
                    ? 'rounded-2xl rounded-br-sm bg-blue-600 text-white px-4 py-2.5 text-sm whitespace-pre-wrap'
                    : 'rounded-2xl rounded-bl-sm bg-zinc-800/70 text-zinc-200 px-4 py-2.5 text-sm whitespace-pre-wrap'
                }
              >
                {m.content}
              </div>
              {m.artifacts && m.artifacts.length > 0 && (
                <div className="mt-2 space-y-2">
                  {m.artifacts.map((a, j) => <ArtifactRenderer key={j} artifact={a} />)}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-zinc-800/70 px-4 py-3 text-sm text-zinc-400 flex items-center gap-2">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" />
              </span>
              Analizuję dane…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Kompozytor */}
      <div className="border-t border-zinc-800 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 focus-within:ring-1 focus-within:ring-blue-500">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Zapytaj o dane albo poproś o widget…"
            className="flex-1 resize-none bg-transparent text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none max-h-32"
          />
          <button
            onClick={submit}
            disabled={loading || !input.trim()}
            className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Wyślij"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-[11px] text-zinc-600 mt-1.5 px-1">
          Asystent ma dostęp tylko do odczytu danych analitycznych. Enter wysyła, Shift+Enter — nowa linia.
        </p>
      </div>
    </div>
  );
}

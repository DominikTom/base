'use client';

import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Sparkles, Info } from 'lucide-react';
import { ArtifactRenderer } from './artifact-renderer';
import { AnswerDetails } from './answer-details';
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

// Renderowanie Markdown w odpowiedziach asystenta — dzięki temu tabele,
// nagłówki i pogrubienia wyglądają jak tabele/tekst, a nie surowy `| ... |`.
// react-markdown przekazuje prop `node` (węzeł hast) — odcinamy go, żeby
// nie trafił do DOM. Fabryka mdTag robi to w jednym miejscu.
type MdProps = { node?: unknown; children?: ReactNode };

function mdTag(tag: string, className: string) {
  return function MdEl({ node, ...rest }: MdProps) {
    void node;
    return createElement(tag, { className, ...rest });
  };
}

const MD: Components = {
  p: mdTag('p', 'my-1.5 first:mt-0 last:mb-0 leading-relaxed'),
  h1: mdTag('h1', 'text-base font-semibold text-zinc-100 mt-3 mb-1.5 first:mt-0'),
  h2: mdTag('h2', 'text-sm font-semibold text-zinc-100 mt-3 mb-1.5 first:mt-0'),
  h3: mdTag('h3', 'text-sm font-semibold text-zinc-200 mt-2.5 mb-1 first:mt-0'),
  ul: mdTag('ul', 'list-disc ml-4 my-1.5 space-y-0.5'),
  ol: mdTag('ol', 'list-decimal ml-4 my-1.5 space-y-0.5'),
  li: mdTag('li', 'leading-relaxed'),
  strong: mdTag('strong', 'font-semibold text-zinc-100'),
  code: mdTag('code', 'bg-zinc-900/80 rounded px-1 py-0.5 text-[0.85em] font-mono text-zinc-200'),
  pre: mdTag('pre', 'bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 my-2 overflow-x-auto text-[12px]'),
  thead: mdTag('thead', 'bg-zinc-800/60'),
  th: mdTag('th', 'text-left font-medium text-zinc-300 px-2.5 py-1.5 border-b border-zinc-700'),
  td: mdTag('td', 'px-2.5 py-1.5 border-b border-zinc-800/60 text-zinc-300'),
  hr: () => <hr className="my-3 border-zinc-700/60" />,
  a: ({ node, ...rest }: MdProps) => {
    void node;
    return <a className="text-blue-400 hover:underline" target="_blank" rel="noreferrer" {...rest} />;
  },
  table: ({ node, ...rest }: MdProps) => {
    void node;
    return (
      <div className="my-2 overflow-x-auto rounded-lg border border-zinc-700/70">
        <table className="w-full border-collapse text-xs" {...rest} />
      </div>
    );
  },
};

export function ChatThread({ messages, loading, onSend }: ChatThreadProps) {
  const [input, setInput] = useState('');
  const [detailsIdx, setDetailsIdx] = useState<number | null>(null);
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

  const detailsMeta = detailsIdx != null ? messages[detailsIdx]?.meta : null;

  return (
    <div className="flex flex-col h-full">
      {/* Wiadomości */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
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

        {messages.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 text-white px-4 py-2.5 text-sm whitespace-pre-wrap">
                  {m.content}
                </div>
              </div>
            );
          }
          const sqlCount = m.meta?.steps.filter(s => s.kind === 'sql').length ?? 0;
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[92%] w-full space-y-2">
                {m.content && (
                  <div className="rounded-2xl rounded-tl-sm bg-zinc-800/50 border border-zinc-800 px-4 py-3 text-sm text-zinc-200">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
                      {m.content}
                    </ReactMarkdown>
                  </div>
                )}
                {m.artifacts?.map((a, j) => <ArtifactRenderer key={j} artifact={a} />)}
                {m.meta && m.meta.steps.length > 0 && (
                  <button
                    onClick={() => setDetailsIdx(i)}
                    className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-blue-400 transition-colors"
                  >
                    <Info size={12} />
                    Jak to policzono{sqlCount > 0 ? ` · ${sqlCount} zapytań SQL` : ''}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-tl-sm bg-zinc-800/50 border border-zinc-800 px-4 py-3 text-sm text-zinc-400 flex items-center gap-2">
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

      {detailsMeta && (
        <AnswerDetails meta={detailsMeta} onClose={() => setDetailsIdx(null)} />
      )}
    </div>
  );
}

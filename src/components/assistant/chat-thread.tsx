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
  h1: mdTag('h1', 'text-base font-semibold text-ink mt-3 mb-1.5 first:mt-0'),
  h2: mdTag('h2', 'text-sm font-semibold text-ink mt-3 mb-1.5 first:mt-0'),
  h3: mdTag('h3', 'text-sm font-semibold text-ink mt-2.5 mb-1 first:mt-0'),
  ul: mdTag('ul', 'list-disc ml-4 my-1.5 space-y-0.5'),
  ol: mdTag('ol', 'list-decimal ml-4 my-1.5 space-y-0.5'),
  li: mdTag('li', 'leading-relaxed'),
  strong: mdTag('strong', 'font-semibold text-ink'),
  code: mdTag('code', 'bg-surface-2 rounded px-1 py-0.5 text-[0.85em] font-mono text-ink'),
  pre: mdTag('pre', 'bg-surface-2 border border-line rounded-lg p-2.5 my-2 overflow-x-auto text-[12px]'),
  thead: mdTag('thead', 'bg-surface-2/60'),
  th: mdTag('th', 'text-left font-medium text-ink-soft px-2.5 py-1.5 border-b border-line'),
  td: mdTag('td', 'px-2.5 py-1.5 border-b border-line/60 text-ink-soft'),
  hr: () => <hr className="my-3 border-line/60" />,
  a: ({ node, ...rest }: MdProps) => {
    void node;
    return <a className="text-primary-ink hover:underline" target="_blank" rel="noreferrer" {...rest} />;
  },
  table: ({ node, ...rest }: MdProps) => {
    void node;
    return (
      <div className="my-2 overflow-x-auto rounded-lg border border-line/70">
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
            <div className="w-12 h-12 rounded-xl bg-primary-soft flex items-center justify-center">
              <Sparkles size={24} className="text-primary-ink" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink">Asystent AI</h2>
              <p className="text-sm text-ink-muted mt-1 max-w-md">
                Zadaj pytanie o dane sprzedażowe, marketingowe lub ruch. Mogę też dodać widget na dashboardzie albo KPI.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-md">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  className="text-left text-sm px-3 py-2 rounded-xl border border-line text-ink-soft hover:bg-surface-2 hover:text-ink transition-colors"
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
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-white px-4 py-2.5 text-sm whitespace-pre-wrap">
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
                  <div className="rounded-2xl rounded-tl-sm bg-surface border border-line shadow-card px-4 py-3 text-sm text-ink">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
                      {m.content}
                    </ReactMarkdown>
                  </div>
                )}
                {m.artifacts?.map((a, j) => <ArtifactRenderer key={j} artifact={a} />)}
                {m.meta && m.meta.steps.length > 0 && (
                  <button
                    onClick={() => setDetailsIdx(i)}
                    className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted hover:text-primary-ink transition-colors"
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
            <div className="rounded-2xl rounded-tl-sm bg-surface border border-line shadow-card px-4 py-3 text-sm text-ink-faint flex items-center gap-2">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce" />
              </span>
              Analizuję dane…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Kompozytor */}
      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10">
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
            className="flex-1 resize-none bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none max-h-32"
          />
          <button
            onClick={submit}
            disabled={loading || !input.trim()}
            className="btn-primary p-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Wyślij"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-[11px] text-ink-faint mt-1.5 px-1">
          Asystent ma dostęp tylko do odczytu danych analitycznych. Enter wysyła, Shift+Enter — nowa linia.
        </p>
      </div>

      {detailsMeta && (
        <AnswerDetails meta={detailsMeta} onClose={() => setDetailsIdx(null)} />
      )}
    </div>
  );
}

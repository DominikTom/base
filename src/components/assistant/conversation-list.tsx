'use client';

import { Plus, MessageSquare, Trash2 } from 'lucide-react';
import type { ConversationSummary } from '@/lib/assistant/types';

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ConversationList({ conversations, activeId, onSelect, onNew, onDelete }: ConversationListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3">
        <button
          onClick={onNew}
          className="btn-primary w-full gap-2 px-3 py-2 text-sm"
        >
          <Plus size={16} />
          Nowa rozmowa
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {conversations.length === 0 && (
          <p className="text-xs text-ink-muted px-2 py-3">Brak rozmów. Zacznij nową.</p>
        )}
        {conversations.map(c => (
          <div
            key={c.id}
            className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
              c.id === activeId ? 'bg-surface-2 text-ink' : 'text-ink-soft hover:bg-surface-2'
            }`}
            onClick={() => onSelect(c.id)}
          >
            <MessageSquare size={14} className="shrink-0 text-ink-faint" />
            <span className="flex-1 text-xs truncate">{c.title || 'Rozmowa'}</span>
            <button
              onClick={e => { e.stopPropagation(); onDelete(c.id); }}
              className="p-0.5 text-ink-faint hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Usuń rozmowę"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

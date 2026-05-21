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
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          Nowa rozmowa
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {conversations.length === 0 && (
          <p className="text-xs text-zinc-600 px-2 py-3">Brak rozmów. Zacznij nową.</p>
        )}
        {conversations.map(c => (
          <div
            key={c.id}
            className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
              c.id === activeId ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50'
            }`}
            onClick={() => onSelect(c.id)}
          >
            <MessageSquare size={14} className="shrink-0 text-zinc-600" />
            <span className="flex-1 text-xs truncate">{c.title || 'Rozmowa'}</span>
            <button
              onClick={e => { e.stopPropagation(); onDelete(c.id); }}
              className="p-0.5 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
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

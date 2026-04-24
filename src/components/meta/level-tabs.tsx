'use client';

import { Megaphone, Layers, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MetaLevel = 'campaign' | 'adset' | 'creative';

const TABS: Array<{ value: MetaLevel; label: string; icon: React.ReactNode }> = [
  { value: 'campaign', label: 'Kampanie', icon: <Megaphone size={14} /> },
  { value: 'adset', label: 'Zestawy reklam', icon: <Layers size={14} /> },
  { value: 'creative', label: 'Kreacje', icon: <Sparkles size={14} /> },
];

export function LevelTabs({
  value,
  onChange,
}: {
  value: MetaLevel;
  onChange: (next: MetaLevel) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-zinc-900/60 border border-zinc-800">
      {TABS.map(t => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors',
              active
                ? 'bg-zinc-800 text-zinc-100 font-medium'
                : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

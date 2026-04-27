'use client';

import { Activity, Sparkles, Megaphone, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

// View — task-oriented, nie hierarchia. Kolejność = ważność dla creative team:
// 1. Pulse (heads-up co dziś), 2. Kreacje (główna praca), 3. Kampanie (kontekst
// operacyjny — agencja je ustawia), 4. Insights (auto rekomendacje).
export type MetaView = 'pulse' | 'creatives' | 'campaigns' | 'insights';

const TABS: Array<{ value: MetaView; label: string; icon: React.ReactNode }> = [
  { value: 'pulse', label: 'Pulse', icon: <Activity size={14} /> },
  { value: 'creatives', label: 'Kreacje', icon: <Sparkles size={14} /> },
  { value: 'campaigns', label: 'Kampanie', icon: <Megaphone size={14} /> },
  { value: 'insights', label: 'Insights', icon: <Lightbulb size={14} /> },
];

export function ViewTabs({
  value,
  onChange,
}: {
  value: MetaView;
  onChange: (next: MetaView) => void;
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

// Sub-tabs dla zakładki Kampanie (kontekst operacyjny — campaign vs adset)
export type CampaignSubview = 'campaigns' | 'adsets';
const CAMPAIGN_SUBTABS: Array<{ value: CampaignSubview; label: string }> = [
  { value: 'campaigns', label: 'Kampanie' },
  { value: 'adsets', label: 'Zestawy reklam' },
];

export function CampaignSubTabs({
  value,
  onChange,
}: {
  value: CampaignSubview;
  onChange: (next: CampaignSubview) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 border-b border-zinc-800">
      {CAMPAIGN_SUBTABS.map(t => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className={cn(
              'px-4 py-2 text-sm transition-colors -mb-px border-b-2',
              active
                ? 'border-blue-500 text-zinc-100 font-medium'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

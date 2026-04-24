'use client';

import { X, Megaphone, Layers } from 'lucide-react';

export interface FilterChipsContext {
  campaign: { id: string; name: string } | null;
  adset: { id: string; name: string; campaign_id: string | null; campaign_name: string | null } | null;
}

export function FilterChips({
  context,
  onClearCampaign,
  onClearAdset,
}: {
  context: FilterChipsContext;
  onClearCampaign: () => void;
  onClearAdset: () => void;
}) {
  if (!context.campaign && !context.adset) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-zinc-500">Filtr:</span>
      {context.campaign && (
        <button
          onClick={onClearCampaign}
          className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300 hover:bg-blue-500/20 transition-colors"
        >
          <Megaphone size={11} />
          <span className="max-w-[200px] truncate">Kampania: {context.campaign.name}</span>
          <X size={12} className="opacity-60 group-hover:opacity-100" />
        </button>
      )}
      {context.adset && (
        <button
          onClick={onClearAdset}
          className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 hover:bg-amber-500/20 transition-colors"
        >
          <Layers size={11} />
          <span className="max-w-[200px] truncate">Zestaw: {context.adset.name}</span>
          <X size={12} className="opacity-60 group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}

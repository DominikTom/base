'use client';

import { useState } from 'react';
import { X, NotebookPen } from 'lucide-react';
import { FUNNEL_STAGES } from '@/lib/marketing-constants';
import type { CampaignRow } from './types';

// Edytor pól manualnych kampanii: cel wewnętrzny (np. „test kreacji",
// „feedowanie bazy kontaktów"), etap lejka i krótka notatka.
// Pola z Meta API (objective, status) nadpisuje wyłącznie ETL.
export function CampaignMetaEditor({
  campaign, onClose, onSaved,
}: {
  campaign: CampaignRow;
  onClose: () => void;
  onSaved: (fields: { purpose: string | null; funnelStage: string | null; notes: string | null }) => void;
}) {
  const [purpose, setPurpose] = useState(campaign.purpose || '');
  const [funnelStage, setFunnelStage] = useState(campaign.funnelStage || '');
  const [notes, setNotes] = useState(campaign.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/marketing/campaign-meta', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaign.campaignId,
          account_id: campaign.accountId,
          purpose: purpose.trim() || null,
          funnel_stage: funnelStage || null,
          notes: notes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onSaved({
        purpose: purpose.trim() || null,
        funnelStage: funnelStage || null,
        notes: notes.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-card border border-line bg-surface shadow-pop"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-line">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
              <NotebookPen size={15} className="text-muted" /> Metadane kampanii
            </h3>
            <p className="text-xs text-muted mt-0.5 truncate">{campaign.campaignName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-bg">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-xs text-fg-soft">Cel wewnętrzny (np. „test kreacji”, „feedowanie bazy kontaktów”)</span>
            <input
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              maxLength={120}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg border border-line text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </label>
          <label className="block">
            <span className="text-xs text-fg-soft">Etap lejka</span>
            <select
              value={funnelStage}
              onChange={e => setFunnelStage(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg border border-line text-sm text-fg"
            >
              <option value="">— brak —</option>
              {FUNNEL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-fg-soft">Krótka notatka</span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg border border-line text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
            />
          </label>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 pt-0">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg text-fg-soft hover:text-fg hover:bg-bg">
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg btn-primary-gradient"
          >
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}

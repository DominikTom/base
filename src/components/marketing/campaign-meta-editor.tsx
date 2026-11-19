'use client';

import { useState } from 'react';
import { X, NotebookPen } from 'lucide-react';
import { FUNNEL_STAGES } from '@/lib/marketing-constants';
import { TagInput } from './tag-input';
import type { CampaignRow, CampaignMetaFields } from './types';

// Edytor pól manualnych kampanii: cel wewnętrzny (np. „test kreacji",
// „feedowanie bazy kontaktów"), etap lejka, własne tagi i krótka notatka.
// Pola z Meta API (objective, status) nadpisuje wyłącznie ETL.
export function CampaignMetaEditor({
  campaign, onClose, onSaved,
}: {
  campaign: CampaignRow;
  onClose: () => void;
  onSaved: (fields: CampaignMetaFields) => void;
}) {
  const [purpose, setPurpose] = useState(campaign.purpose || '');
  const [funnelStage, setFunnelStage] = useState(campaign.funnelStage || '');
  const [notes, setNotes] = useState(campaign.notes || '');
  const [tags, setTags] = useState<string[]>(campaign.tags || []);
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
          tags,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onSaved({
        purpose: purpose.trim() || null,
        funnelStage: funnelStage || null,
        notes: notes.trim() || null,
        tags,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md card shadow-pop animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-line">
          <div className="min-w-0">
            <h3 className="section-title flex items-center gap-2">
              <NotebookPen size={15} className="text-ink-muted" /> Metadane kampanii
            </h3>
            <p className="text-xs text-ink-muted mt-0.5 truncate">{campaign.campaignName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-xs text-ink-soft">Cel wewnętrzny (np. „test kreacji”, „feedowanie bazy kontaktów”)</span>
            <input
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              maxLength={120}
              className="input mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-soft">Etap lejka</span>
            <select
              value={funnelStage}
              onChange={e => setFunnelStage(e.target.value)}
              className="input mt-1"
            >
              <option value="">— brak —</option>
              {FUNNEL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div>
            <span className="text-xs text-ink-soft">Tagi (Enter dodaje; filtrujesz po nich listę kampanii)</span>
            <TagInput tags={tags} onChange={setTags} />
          </div>
          <label className="block">
            <span className="text-xs text-ink-soft">Krótka notatka</span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              className="input mt-1 resize-none"
            />
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 pt-0">
          <button onClick={onClose} className="btn-ghost px-3 py-2">
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}

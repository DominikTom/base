'use client';

import { useState } from 'react';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { FUNNEL_STAGES, OBJECTIVE_LABELS, type AttributionWindow } from '@/lib/marketing-constants';
import { X, NotebookPen } from 'lucide-react';
import { AttributionSelect, ExportCsvButton } from './controls';
import { attributed, type CampaignRow } from './types';

interface CampaignsTabProps {
  campaigns: CampaignRow[];
  dateFrom: string;
  dateTo: string;
  shop: string;
  attribution: AttributionWindow;
  onAttributionChange: (w: AttributionWindow) => void;
  onMetaSaved: (campaignId: string, fields: { purpose: string | null; funnelStage: string | null; notes: string | null }) => void;
}

// Zakładka Kampanie: cel Meta (objective) + pola manualne Kamili (cel
// wewnętrzny, etap lejka, notatka — klik w wiersz otwiera edytor),
// metryki awareness/leads i przełącznik atrybucji dla Zakupy/Przychód/ROAS.
export function CampaignsTab({
  campaigns, dateFrom, dateTo, shop, attribution, onAttributionChange, onMetaSaved,
}: CampaignsTabProps) {
  const [editing, setEditing] = useState<CampaignRow | null>(null);

  const columns: Column<CampaignRow>[] = [
    { key: 'campaignName', header: 'Kampania', accessor: r => r.campaignName, className: 'max-w-[260px] truncate' },
    { key: 'shop', header: 'Sklep', accessor: r => r.shop },
    {
      key: 'objective', header: 'Cel Meta',
      accessor: r => r.objective ? (OBJECTIVE_LABELS[r.objective] || r.objective) : '—',
    },
    { key: 'funnelStage', header: 'Etap lejka', accessor: r => r.funnelStage || '—', align: 'center' },
    { key: 'purpose', header: 'Cel wewnętrzny', accessor: r => r.purpose || '—', className: 'max-w-[160px] truncate' },
    { key: 'notes', header: 'Notatka', accessor: r => r.notes || '', format: v => (v ? '📝' : ''), align: 'center', sortable: false },
    { key: 'spend', header: 'Wydatki', accessor: r => r.spend, align: 'right', format: v => formatCurrency(v as number) },
    { key: 'reach', header: 'Zasięg', accessor: r => r.reach, align: 'right', format: v => formatNumber(v as number) },
    { key: 'frequency', header: 'Częst.', accessor: r => r.frequency, align: 'right', format: v => (v as number).toFixed(2) },
    { key: 'cpm', header: 'CPM', accessor: r => r.cpm, align: 'right', format: v => `${(v as number).toFixed(2)} zł` },
    { key: 'ctr', header: 'CTR', accessor: r => r.ctr, align: 'right', format: v => `${(v as number).toFixed(2)}%` },
    { key: 'leads', header: 'Leady', accessor: r => r.leads, align: 'right' },
    {
      key: 'cpl', header: 'CPL', accessor: r => r.cpl, align: 'right',
      format: v => (v as number) > 0 ? `${(v as number).toFixed(2)} zł` : '—',
    },
    { key: 'purchases', header: 'Zakupy', accessor: r => attributed(r, attribution).purchases, align: 'right' },
    {
      key: 'revenue', header: 'Przychód', accessor: r => attributed(r, attribution).revenue, align: 'right',
      format: v => formatCurrency(v as number),
    },
    {
      key: 'roas', header: 'ROAS', accessor: r => attributed(r, attribution).roas, align: 'right',
      format: v => `${(v as number).toFixed(2)}×`,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          Kliknij wiersz, aby uzupełnić cel wewnętrzny, etap lejka lub notatkę.
        </p>
        <div className="flex items-center gap-3">
          <AttributionSelect value={attribution} onChange={onAttributionChange} />
          <ExportCsvButton scope="campaigns" dateFrom={dateFrom} dateTo={dateTo} shop={shop} />
        </div>
      </div>
      <DataTable data={campaigns} columns={columns} pageSize={15} onRowClick={setEditing} />
      {editing && (
        <CampaignMetaEditor
          campaign={editing}
          onClose={() => setEditing(null)}
          onSaved={fields => {
            onMetaSaved(editing.campaignId, fields);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function CampaignMetaEditor({
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-zinc-800">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <NotebookPen size={15} className="text-zinc-500" /> Metadane kampanii
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{campaign.campaignName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-xs text-zinc-400">Cel wewnętrzny (np. „test kreacji”, „feedowanie bazy kontaktów”)</span>
            <input
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              maxLength={120}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-400">Etap lejka</span>
            <select
              value={funnelStage}
              onChange={e => setFunnelStage(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200"
            >
              <option value="">— brak —</option>
              {FUNNEL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-zinc-400">Krótka notatka</span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 pt-0">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800">
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          >
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { parseErpCsv, type RawCsvRow } from '@/lib/erp-parser';
import { ChartCard } from '@/components/charts/chart-card';
import { KpiCard } from '@/components/ui/kpi-card';
import { formatNumber } from '@/lib/utils';
import { Upload, CheckCircle, XCircle, Clock, RefreshCw, FileText, FolderSync, Euro } from 'lucide-react';
import type { EtlLog } from '@/types/database';

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) throw new Error(`Serwer zwrócił pustą odpowiedź (HTTP ${res.status})`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Serwer zwrócił błąd (HTTP ${res.status}): ${text.substring(0, 200)}`);
  }
}

type Phase =
  | 'idle'
  | 'parsing'
  | 'starting'
  | 'uploading_orders'
  | 'uploading_items'
  | 'finalizing'
  | 'done'
  | 'error';

const ORDER_BATCH_SIZE = 200;
const ITEM_BATCH_SIZE = 500;

export default function AdminPage() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' });
  const [uploadResult, setUploadResult] = useState<Record<string, unknown> | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [logs, setLogs] = useState<EtlLog[]>([]);
  const [freshness, setFreshness] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [gdriveSyncing, setGdriveSyncing] = useState(false);
  const [gdriveSyncResult, setGdriveSyncResult] = useState<{ ok: boolean; message: string } | null>(null);
  const abortRef = useRef(false);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/etl/status');
      const json = await res.json();
      setLogs(json.logs || []);
      setFreshness(json.freshness || {});
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  async function handleManualGdriveSync() {
    setGdriveSyncing(true);
    setGdriveSyncResult(null);
    try {
      const res = await fetch('/api/etl/gdrive-request-sync', { method: 'POST' });
      const json = await safeJson(res);
      if (!res.ok) {
        setGdriveSyncResult({ ok: false, message: String(json.error || `HTTP ${res.status}`) });
      } else {
        const msg = String(json.message || 'Manual sync queued.');
        const req = json.requestId ? ` (#${json.requestId})` : '';
        setGdriveSyncResult({ ok: true, message: `${msg}${req}` });
        await fetchLogs();
      }
    } catch (err) {
      setGdriveSyncResult({ ok: false, message: String(err) });
    } finally {
      setGdriveSyncing(false);
    }
  }

  async function handleUpload() {
    if (!file) return;
    abortRef.current = false;
    setUploadResult(null);
    setUploadError(null);

    try {
      // ── Phase 1: Parse CSV in browser ──────────────────────────────────
      setPhase('parsing');
      setProgress({ current: 0, total: 0, label: 'Parsowanie CSV w przeglądarce...' });

      const text = await file.text();
      const parseResult = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
      }) as Papa.ParseResult<RawCsvRow>;

      if (parseResult.errors.length > 50) {
        throw new Error(`Za dużo błędów parsowania CSV: ${parseResult.errors.length}`);
      }

      const result = await parseErpCsv(parseResult.data);
      const { orders, items, stats, quarantine, warnings } = result;
      const rawRows = parseResult.data;

      // ── Compute daily revenue aggregation in browser ──────────────────
      const dailyRevMap: Record<string, {
        orders_count: number; orders_paid: number; orders_cancelled: number;
        revenue_gross_pln: number; revenue_paid_pln: number; shipping_revenue_pln: number;
        revenue_gross_original: number; original_currency: string;
      }> = {};

      for (const o of orders) {
        const date = o.order_date.substring(0, 10);
        const key = `${date}|${o.source_shop}`;
        if (!dailyRevMap[key]) {
          dailyRevMap[key] = {
            orders_count: 0, orders_paid: 0, orders_cancelled: 0,
            revenue_gross_pln: 0, revenue_paid_pln: 0, shipping_revenue_pln: 0,
            revenue_gross_original: 0, original_currency: o.currency || 'PLN',
          };
        }
        const g = dailyRevMap[key];
        g.orders_count++;
        if (o.is_paid) g.orders_paid++;
        if (o.status === 'anulowane') g.orders_cancelled++;
        g.revenue_gross_pln += o.total_gross_pln || 0;
        if (o.is_paid) g.revenue_paid_pln += o.total_gross_pln || 0;
        g.shipping_revenue_pln += o.shipping_cost_pln || 0;
        g.revenue_gross_original += o.total_gross || 0;
      }

      const dailyRevenueRows = Object.entries(dailyRevMap).map(([key, g]) => {
        const [date, source_shop] = key.split('|');
        return {
          date, source_shop,
          orders_count: g.orders_count, orders_paid: g.orders_paid, orders_cancelled: g.orders_cancelled,
          revenue_gross_pln: Math.round(g.revenue_gross_pln * 100) / 100,
          revenue_paid_pln: Math.round(g.revenue_paid_pln * 100) / 100,
          shipping_revenue_pln: Math.round(g.shipping_revenue_pln * 100) / 100,
          avg_order_value_pln: g.orders_count > 0 ? Math.round((g.revenue_gross_pln / g.orders_count) * 100) / 100 : 0,
          revenue_gross_original: Math.round(g.revenue_gross_original * 100) / 100,
          original_currency: g.original_currency,
        };
      });

      setProgress({ current: 0, total: 0, label: `Sparsowano: ${formatNumber(stats.ordersCount)} zamówień, ${formatNumber(stats.itemsCount)} pozycji, ${formatNumber(dailyRevenueRows.length)} dni revenue` });

      // ── Phase 2: Start (create ETL log, delete old data) ──────────────
      setPhase('starting');
      setProgress({ current: 0, total: 0, label: 'Przygotowanie bazy danych...' });

      const startRes = await fetch('/api/etl/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          filename: file.name,
          dateRange: stats.dateRange,
        }),
      });
      const startData = await safeJson(startRes);
      if (!startRes.ok) throw new Error(String(startData.error) || 'Start failed');
      const etlLogId = startData.etlLogId;
      const etlRunId = String(startData.etlRunId);

      if (abortRef.current) throw new Error('Anulowano');

      // ── Phase 2.5: Raw landing append (audit trail) ───────────────────
      const RAW_BATCH = 500;
      for (let i = 0; i < rawRows.length; i += RAW_BATCH) {
        if (abortRef.current) throw new Error('Anulowano');
        const batch = rawRows.slice(i, i + RAW_BATCH);
        setProgress({
          current: Math.min(i + RAW_BATCH, rawRows.length),
          total: rawRows.length,
          label: `Raw landing: ${formatNumber(Math.min(i + RAW_BATCH, rawRows.length))} / ${formatNumber(rawRows.length)}`,
        });
        const res = await fetch('/api/etl/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'batch_raw',
            etlLogId,
            etlRunId,
            filename: file.name,
            startRowNumber: i + 2, // +1 zero-index, +1 header
            rows: batch,
          }),
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(String(data.error) || 'Batch raw failed');
      }

      // ── Phase 3: Upload orders in batches ─────────────────────────────
      setPhase('uploading_orders');
      let ordersInserted = 0;
      const totalOrders = orders.length;

      for (let i = 0; i < totalOrders; i += ORDER_BATCH_SIZE) {
        if (abortRef.current) throw new Error('Anulowano');
        const batch = orders.slice(i, i + ORDER_BATCH_SIZE);

        setProgress({
          current: Math.min(i + ORDER_BATCH_SIZE, totalOrders),
          total: totalOrders,
          label: `Wysyłanie zamówień: ${formatNumber(Math.min(i + ORDER_BATCH_SIZE, totalOrders))} / ${formatNumber(totalOrders)}`,
        });

        const res = await fetch('/api/etl/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'batch_orders', etlLogId, orders: batch }),
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(String(data.error) || 'Batch orders failed');
        ordersInserted += (data.inserted as number) || 0;
      }

      // ── Phase 4: Upload items in batches ──────────────────────────────
      setPhase('uploading_items');
      let itemsInserted = 0;
      const totalItems = items.length;

      for (let i = 0; i < totalItems; i += ITEM_BATCH_SIZE) {
        if (abortRef.current) throw new Error('Anulowano');
        const batch = items.slice(i, i + ITEM_BATCH_SIZE);

        setProgress({
          current: Math.min(i + ITEM_BATCH_SIZE, totalItems),
          total: totalItems,
          label: `Wysyłanie pozycji: ${formatNumber(Math.min(i + ITEM_BATCH_SIZE, totalItems))} / ${formatNumber(totalItems)}`,
        });

        const res = await fetch('/api/etl/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'batch_items', etlLogId, items: batch }),
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(String(data.error) || 'Batch items failed');
        itemsInserted += (data.inserted as number) || 0;
      }

      // ── Phase 5: Upload daily revenue (pre-computed in browser) ──────
      setPhase('finalizing');
      const REVENUE_BATCH = 500;
      for (let i = 0; i < dailyRevenueRows.length; i += REVENUE_BATCH) {
        if (abortRef.current) throw new Error('Anulowano');
        const batch = dailyRevenueRows.slice(i, i + REVENUE_BATCH);
        setProgress({
          current: Math.min(i + REVENUE_BATCH, dailyRevenueRows.length),
          total: dailyRevenueRows.length,
          label: `Wysyłanie daily revenue: ${formatNumber(Math.min(i + REVENUE_BATCH, dailyRevenueRows.length))} / ${formatNumber(dailyRevenueRows.length)}`,
        });
        const res = await fetch('/api/etl/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'batch_daily_revenue', etlLogId, rows: batch }),
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(String(data.error) || 'Batch daily revenue failed');
      }

      // ── Phase 5.5: Quarantine batch (fail-soft rows) ──────────────────
      if (quarantine.length) {
        const QUARANTINE_BATCH = 500;
        for (let i = 0; i < quarantine.length; i += QUARANTINE_BATCH) {
          if (abortRef.current) throw new Error('Anulowano');
          const batch = quarantine.slice(i, i + QUARANTINE_BATCH);
          const res = await fetch('/api/etl/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'batch_quarantine',
              etlLogId,
              etlRunId,
              filename: file.name,
              entries: batch,
            }),
          });
          const data = await safeJson(res);
          if (!res.ok) throw new Error(String(data.error) || 'Batch quarantine failed');
        }
      }

      // ── Phase 6: Finalize (sanity checks + update ETL log) ────────────
      setProgress({ current: 0, total: 0, label: 'Finalizacja + sanity check...' });

      const finRes = await fetch('/api/etl/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'finalize',
          etlLogId,
          etlRunId,
          stats: {
            totalRows: stats.totalRows,
            ordersCount: ordersInserted,
            itemsCount: itemsInserted,
            quarantinedRows: stats.quarantinedRows,
          },
          warnings,
          dateRange: stats.dateRange,
        }),
      });
      const finData = await safeJson(finRes);
      if (!finRes.ok) throw new Error(String(finData.error) || 'Finalize failed');

      // ── Done ──────────────────────────────────────────────────────────
      setPhase('done');
      setUploadResult({
        stats: {
          ...stats,
          ordersInserted,
          itemsInserted,
          warnings: warnings.length,
          quarantinedRows: stats.quarantinedRows,
        },
        finalize: finData,
      });
      setFile(null);
      fetchLogs();
    } catch (err) {
      setPhase('error');
      setUploadError(String(err instanceof Error ? err.message : err));
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith('.csv')) {
      setFile(droppedFile);
      setPhase('idle');
      setUploadResult(null);
      setUploadError(null);
    }
  }

  const isUploading = !['idle', 'done', 'error'].includes(phase);
  const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const resultStats = uploadResult?.stats as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-fg">ETL Admin</h1>

      {/* Data freshness */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          title="ERP CSV"
          value={freshness['erp_csv'] ? new Date(freshness['erp_csv']).toLocaleDateString('pl-PL') : 'Brak danych'}
          icon={<FileText size={18} />}
          changeLabel="Ostatnia aktualizacja"
        />
        <KpiCard
          title="Meta Ads"
          value={freshness['meta_ads'] ? new Date(freshness['meta_ads']).toLocaleDateString('pl-PL') : 'Brak danych'}
          icon={<Clock size={18} />}
          changeLabel="Ostatnia aktualizacja"
        />
        <KpiCard
          title="Google Drive Sync"
          value={freshness['gdrive_csv'] ? new Date(freshness['gdrive_csv']).toLocaleDateString('pl-PL') : 'Nie skonfigurowano'}
          icon={<FolderSync size={18} />}
          changeLabel="Auto-import codziennie 06:00 PL (CEST) / 05:00 PL (CET)"
        />
      </div>

      {/* Manual GDrive sync */}
      <ChartCard title="Google Drive Sync — ręczne uruchomienie" subtitle="Kolejkuje import. Cron poll odpala sync automatycznie (do ~10 min)">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <button
              onClick={handleManualGdriveSync}
              disabled={gdriveSyncing}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:bg-blue-900/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm"
            >
              {gdriveSyncing ? <RefreshCw size={16} className="animate-spin" /> : <FolderSync size={16} />}
              {gdriveSyncing ? 'Synchronizacja...' : 'Pobierz z Google Drive teraz'}
            </button>
            <span className="text-xs text-muted">To omija timeout requestu w UI — ciężki sync wykona się w tle przez cron.</span>
          </div>
          {gdriveSyncResult && (
            <div className={`rounded-lg border px-3 py-2 text-sm ${
              gdriveSyncResult.ok
                ? 'border-emerald-800 bg-emerald-900/20 text-emerald-400'
                : 'border-red-200 bg-red-900/20 text-danger'
            }`}>
              {gdriveSyncResult.message}
            </div>
          )}
        </div>
      </ChartCard>

      {/* EUR Backfill */}
      <ChartCard title="Przeliczenie EUR→PLN (kurs NBP)" subtitle="Pobiera średni kurs EUR/PLN z NBP per miesiąc i przelicza historyczne zamówienia">
        <div className="space-y-3">
          <div id="eur-current-rate" className="text-sm text-fg-soft">
            Ładowanie aktualnego kursu NBP...
          </div>
          <script dangerouslySetInnerHTML={{ __html: `
            fetch('/api/etl/backfill-eur').then(r=>r.json()).then(d=>{
              const el=document.getElementById('eur-current-rate');
              if(el) el.innerHTML='Aktualny kurs NBP: <span class="text-amber-400 font-bold">'+d.rate+' PLN/EUR</span>'+(d.date?' ('+d.date+')':' (fallback)');
            }).catch(()=>{});
          `}} />
          <div className="flex items-center gap-4">
            <button
              onClick={async () => {
                if (!confirm('Przeliczyć wszystkie zamówienia EUR na PLN kursami miesięcznymi z NBP? To nadpisze istniejące wartości PLN.')) return;
                const btn = document.getElementById('eur-backfill-btn');
                if (btn) btn.textContent = 'Przeliczanie (może potrwać do 60s)...';
                try {
                  const res = await fetch('/api/etl/backfill-eur', { method: 'POST' });
                  const json = await safeJson(res);
                  if (res.ok) {
                    const rates = json.ratesUsed ? Object.entries(json.ratesUsed as Record<string, number>).map(([m,r]) => m+': '+r).join(', ') : '';
                    alert('Przeliczono ' + json.updated + ' zamówień EUR\\n\\nKursy per miesiąc:\\n' + rates);
                  } else alert('Błąd: ' + json.error);
                } catch (err) { alert(String(err)); }
                if (btn) btn.textContent = 'Przelicz EUR→PLN';
              }}
              id="eur-backfill-btn"
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors text-sm"
            >
              <Euro size={16} />
              Przelicz EUR→PLN
            </button>
            <span className="text-xs text-muted">Używa średniego kursu NBP per miesiąc. Nowe importy automatycznie używają kursu z dnia zamówienia.</span>
          </div>
        </div>
      </ChartCard>

      {/* Upload CSV */}
      <ChartCard title="Import CSV z ERP" subtitle="Parsowanie odbywa się w przeglądarce — plik nie jest wysyłany na serwer w całości">
        <div className="space-y-4">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-10 transition-colors ${
              isUploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'
            } ${
              dragOver
                ? 'border-primary-500 bg-blue-500/10'
                : 'border-line hover:border-line bg-bg'
            }`}
            onClick={() => !isUploading && document.getElementById('csv-input')?.click()}
          >
            <Upload size={40} className="text-muted mb-3" />
            <p className="text-sm text-fg-soft">
              {file ? file.name : 'Upuść plik CSV lub kliknij, aby wybrać'}
            </p>
            {file && (
              <p className="text-xs text-muted mt-1">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
            <input
              id="csv-input"
              type="file"
              accept=".csv"
              onChange={e => {
                setFile(e.target.files?.[0] || null);
                setPhase('idle');
                setUploadResult(null);
                setUploadError(null);
              }}
              className="hidden"
            />
          </div>

          {/* Progress bar */}
          {isUploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg-soft flex items-center gap-2">
                  <RefreshCw size={14} className="animate-spin" />
                  {progress.label}
                </span>
                {progress.total > 0 && (
                  <span className="text-muted">{progressPct}%</span>
                )}
              </div>
              <div className="w-full bg-bg rounded-full h-2">
                <div
                  className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress.total > 0 ? progressPct : 100}%` }}
                />
              </div>
              {progress.total === 0 && (
                <div className="w-full bg-bg rounded-full h-2 overflow-hidden">
                  <div className="bg-primary-600 h-2 rounded-full animate-pulse w-full" />
                </div>
              )}
            </div>
          )}

          {/* Upload button */}
          {file && !isUploading && phase !== 'done' && (
            <button
              onClick={handleUpload}
              className="w-full px-5 py-3 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Upload size={18} />
              Importuj CSV
            </button>
          )}

          {/* Cancel button */}
          {isUploading && (
            <button
              onClick={() => { abortRef.current = true; }}
              className="w-full px-5 py-3 bg-bg hover:bg-line text-fg-soft font-medium rounded-lg transition-colors"
            >
              Anuluj import
            </button>
          )}

          {/* Success result */}
          {phase === 'done' && resultStats && (
            <div className="rounded-lg border border-emerald-800 bg-emerald-900/20 p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle size={18} />
                <span className="font-medium">Import zakończony pomyślnie</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="text-muted">Wiersze CSV:</span>
                  <span className="ml-2 text-fg">{formatNumber(resultStats.totalRows as number)}</span>
                </div>
                <div>
                  <span className="text-muted">Zamówienia:</span>
                  <span className="ml-2 text-fg">{formatNumber(resultStats.ordersInserted as number)}</span>
                </div>
                <div>
                  <span className="text-muted">Pozycje:</span>
                  <span className="ml-2 text-fg">{formatNumber(resultStats.itemsInserted as number)}</span>
                </div>
                <div>
                  <span className="text-muted">Tag-only rows:</span>
                  <span className="ml-2 text-fg">{formatNumber(resultStats.tagOnlyRows as number)}</span>
                </div>
              </div>
              {resultStats.byShop ? (
                <div className="text-sm">
                  <span className="text-muted">Sklepy: </span>
                  <span className="text-fg-soft">
                    {Object.entries(resultStats.byShop as Record<string, number>)
                      .map(([shop, count]) => `${shop}: ${formatNumber(count)}`)
                      .join(', ')}
                  </span>
                </div>
              ) : null}
              {resultStats.dateRange ? (
                <div className="text-sm">
                  <span className="text-muted">Zakres dat: </span>
                  <span className="text-fg-soft">
                    {(resultStats.dateRange as Record<string, string>).min} — {(resultStats.dateRange as Record<string, string>).max}
                  </span>
                </div>
              ) : null}
            </div>
          )}

          {/* Error */}
          {phase === 'error' && uploadError && (
            <div className="rounded-lg border border-red-200 bg-red-900/20 p-4 flex items-start gap-2 text-danger">
              <XCircle size={18} className="shrink-0 mt-0.5" />
              <span>{uploadError}</span>
            </div>
          )}
        </div>
      </ChartCard>

      {/* ETL Logs */}
      <ChartCard title="Historia ETL" subtitle="Ostatnie 20 uruchomień">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-fg-soft">
                <th className="px-4 py-3 text-left font-medium">Źródło</th>
                <th className="px-4 py-3 text-left font-medium">Start</th>
                <th className="px-4 py-3 text-left font-medium">Koniec</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Wiersze</th>
                <th className="px-4 py-3 text-left font-medium">Plik</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-line hover:bg-bg">
                  <td className="px-4 py-3 text-fg-soft">{log.source}</td>
                  <td className="px-4 py-3 text-fg-soft text-xs">
                    {new Date(log.started_at).toLocaleString('pl-PL')}
                  </td>
                  <td className="px-4 py-3 text-fg-soft text-xs">
                    {log.finished_at ? new Date(log.finished_at).toLocaleString('pl-PL') : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      log.status === 'success'
                        ? 'bg-emerald-900/50 text-emerald-400'
                        : log.status === 'error'
                        ? 'bg-red-900/50 text-danger'
                        : 'bg-yellow-900/50 text-yellow-400'
                    }`}>
                      {log.status === 'success' ? <CheckCircle size={12} /> : log.status === 'error' ? <XCircle size={12} /> : <Clock size={12} />}
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-fg-soft text-right">{formatNumber(log.rows_processed)}</td>
                  <td className="px-4 py-3 text-muted text-xs max-w-[150px] truncate">{log.csv_filename || '-'}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    Brak wpisów ETL. Zaimportuj pierwszy plik CSV powyżej.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

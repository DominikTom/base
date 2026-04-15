'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChartCard } from '@/components/charts/chart-card';
import { KpiCard } from '@/components/ui/kpi-card';
import { formatNumber } from '@/lib/utils';
import { Upload, CheckCircle, XCircle, Clock, RefreshCw, FileText } from 'lucide-react';
import type { EtlLog } from '@/types/database';

export default function AdminPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<Record<string, unknown> | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [logs, setLogs] = useState<EtlLog[]>([]);
  const [freshness, setFreshness] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);

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

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/etl/upload', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        setUploadError(json.error || 'Upload failed');
      } else {
        setUploadResult(json);
        setFile(null);
        fetchLogs();
      }
    } catch (err) {
      setUploadError(String(err));
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith('.csv')) {
      setFile(droppedFile);
    }
  }

  const stats = uploadResult?.stats as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-zinc-100">ETL Admin</h1>

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
          title="GA4"
          value={freshness['ga4'] ? new Date(freshness['ga4']).toLocaleDateString('pl-PL') : 'Brak danych'}
          icon={<Clock size={18} />}
          changeLabel="Ostatnia aktualizacja"
        />
      </div>

      {/* Upload CSV */}
      <ChartCard title="Import CSV z ERP" subtitle="Przeciągnij plik CSV lub kliknij, aby wybrać">
        <div className="space-y-4">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-10 transition-colors cursor-pointer ${
              dragOver
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-zinc-700 hover:border-zinc-600 bg-zinc-900/30'
            }`}
            onClick={() => document.getElementById('csv-input')?.click()}
          >
            <Upload size={40} className="text-zinc-500 mb-3" />
            <p className="text-sm text-zinc-400">
              {file ? file.name : 'Upuść plik CSV lub kliknij, aby wybrać'}
            </p>
            {file && (
              <p className="text-xs text-zinc-500 mt-1">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
            <input
              id="csv-input"
              type="file"
              accept=".csv"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="hidden"
            />
          </div>

          {file && (
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="w-full px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <RefreshCw size={18} className="animate-spin" />
                  Przetwarzanie...
                </>
              ) : (
                <>
                  <Upload size={18} />
                  Importuj CSV
                </>
              )}
            </button>
          )}

          {/* Upload result */}
          {uploadResult && stats && (
            <div className="rounded-lg border border-emerald-800 bg-emerald-900/20 p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle size={18} />
                <span className="font-medium">Import zakończony pomyślnie</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="text-zinc-500">Wiersze CSV:</span>
                  <span className="ml-2 text-zinc-200">{formatNumber(stats.totalRows as number)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Zamówienia:</span>
                  <span className="ml-2 text-zinc-200">{formatNumber(stats.ordersCount as number)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Pozycje:</span>
                  <span className="ml-2 text-zinc-200">{formatNumber(stats.itemsCount as number)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Tag-only rows:</span>
                  <span className="ml-2 text-zinc-200">{formatNumber(stats.tagOnlyRows as number)}</span>
                </div>
              </div>
              {stats.byShop ? (
                <div className="text-sm">
                  <span className="text-zinc-500">Sklepy: </span>
                  <span className="text-zinc-300">
                    {Object.entries(stats.byShop as Record<string, number>)
                      .map(([shop, count]) => `${shop}: ${formatNumber(count)}`)
                      .join(', ')}
                  </span>
                </div>
              ) : null}
              {stats.dateRange ? (
                <div className="text-sm">
                  <span className="text-zinc-500">Zakres dat: </span>
                  <span className="text-zinc-300">
                    {(stats.dateRange as Record<string, string>).min} — {(stats.dateRange as Record<string, string>).max}
                  </span>
                </div>
              ) : null}
            </div>
          )}

          {uploadError && (
            <div className="rounded-lg border border-red-800 bg-red-900/20 p-4 flex items-center gap-2 text-red-400">
              <XCircle size={18} />
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
              <tr className="border-b border-zinc-800 text-zinc-400">
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
                <tr key={log.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-3 text-zinc-300">{log.source}</td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">
                    {new Date(log.started_at).toLocaleString('pl-PL')}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">
                    {log.finished_at ? new Date(log.finished_at).toLocaleString('pl-PL') : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      log.status === 'success'
                        ? 'bg-emerald-900/50 text-emerald-400'
                        : log.status === 'error'
                        ? 'bg-red-900/50 text-red-400'
                        : 'bg-yellow-900/50 text-yellow-400'
                    }`}>
                      {log.status === 'success' ? <CheckCircle size={12} /> : log.status === 'error' ? <XCircle size={12} /> : <Clock size={12} />}
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-right">{formatNumber(log.rows_processed)}</td>
                  <td className="px-4 py-3 text-zinc-500 text-xs max-w-[150px] truncate">{log.csv_filename || '-'}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
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

'use client';

import { useState, useEffect, useRef } from 'react';
import { RefreshCw, CheckCircle2, XCircle, ChevronDown, Database, Image as ImageIcon, Sparkles, Zap, Loader2 } from 'lucide-react';

interface AccountInfo { accountId: string; shop: string }

type RunningKey =
  | { kind: 'sync'; accountId?: string }
  | { kind: 'thumbnails' }
  | { kind: 'tag' }
  | { kind: 'full' };

interface ResultLine {
  label: string;
  ok: boolean;
  msg: string;
}

const TIMEOUT_PARSE_HINT = 'Timeout (60s Vercel) — spróbuj ponownie albo użyj sync per-sklep z dropdownu';

async function callApi(endpoint: string): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint, { method: 'POST' });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(res.status === 504 ? TIMEOUT_PARSE_HINT : `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const err = typeof json.error === 'string' ? json.error : `HTTP ${res.status}`;
    throw new Error(err);
  }
  return json;
}

export function SyncMenu({ onComplete }: { onComplete?: () => void }) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [running, setRunning] = useState<RunningKey | null>(null);
  const [results, setResults] = useState<ResultLine[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Pobierz listę kont (raz, na mount)
  useEffect(() => {
    fetch('/api/meta/accounts').then(r => r.json()).then(json => {
      setAccounts(json.accounts || []);
    }).catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Auto-clear results po 12s gdy nie ma nic w toku
  useEffect(() => {
    if (running || results.length === 0) return;
    const t = setTimeout(() => setResults([]), 12000);
    return () => clearTimeout(t);
  }, [running, results]);

  function pushResult(r: ResultLine) {
    setResults(prev => [...prev.slice(-4), r]);
  }

  async function runSyncForAccount(account: AccountInfo) {
    setRunning({ kind: 'sync', accountId: account.accountId });
    try {
      const json = await callApi(`/api/etl/meta-ad-sync?days=14&account=${account.accountId}`);
      pushResult({
        label: account.shop,
        ok: true,
        msg: `${json.totalRows ?? 0} wierszy, ${json.newCreatives ?? 0} nowych kreacji`,
      });
    } catch (err) {
      pushResult({
        label: account.shop,
        ok: false,
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function runFullSync() {
    setOpen(false);
    setRunning({ kind: 'full' });
    setResults([]);
    try {
      // 1. Per-account sync żeby uniknąć timeoutu
      for (const acc of accounts) {
        await runSyncForAccount(acc);
      }
      // 2. Refresh thumbnails (próba 100, do 60s)
      setRunning({ kind: 'thumbnails' });
      try {
        const json = await callApi('/api/jobs/refresh-thumbnails');
        pushResult({
          label: 'Podglądy',
          ok: true,
          msg: `${json.processed ?? 0} przetworzonych, ${json.failed ?? 0} błędów`,
        });
      } catch (err) {
        pushResult({ label: 'Podglądy', ok: false, msg: err instanceof Error ? err.message : String(err) });
      }
      // 3. AI tagging (50 sztuk)
      setRunning({ kind: 'tag' });
      try {
        const json = await callApi('/api/jobs/tag-creatives?limit=50');
        pushResult({
          label: 'AI tagging',
          ok: true,
          msg: `${json.succeeded ?? 0} otagowanych, ${json.remaining ?? 0} w kolejce`,
        });
      } catch (err) {
        pushResult({ label: 'AI tagging', ok: false, msg: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setRunning(null);
      onComplete?.();
    }
  }

  async function runSingle(label: string, endpoint: string, parser: (j: Record<string, unknown>) => string, kind: RunningKey['kind']) {
    setOpen(false);
    setRunning({ kind } as RunningKey);
    setResults([]);
    try {
      const json = await callApi(endpoint);
      pushResult({ label, ok: true, msg: parser(json) });
      onComplete?.();
    } catch (err) {
      pushResult({ label, ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(null);
    }
  }

  const isRunning = running !== null;

  // Inline progress label
  let runningLabel = '';
  if (running?.kind === 'sync' && running.accountId) {
    const acc = accounts.find(a => a.accountId === running.accountId);
    runningLabel = `Sync ${acc?.shop || running.accountId}…`;
  } else if (running?.kind === 'thumbnails') runningLabel = 'Odświeżam podglądy…';
  else if (running?.kind === 'tag') runningLabel = 'Otagowuję AI…';
  else if (running?.kind === 'full') runningLabel = 'Pełny sync…';

  return (
    <div className="flex items-center gap-3">
      {/* Inline progress + result lines */}
      {(isRunning || results.length > 0) && (
        <div className="flex flex-col items-end gap-0.5 text-[11px] max-w-[380px]">
          {isRunning && (
            <span className="flex items-center gap-1.5 text-zinc-400">
              <Loader2 size={11} className="animate-spin" />
              {runningLabel}
            </span>
          )}
          {results.slice(-3).map((r, i) => (
            <span
              key={i}
              className={`flex items-center gap-1.5 ${r.ok ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {r.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
              <span className="truncate"><b>{r.label}:</b> {r.msg}</span>
            </span>
          ))}
        </div>
      )}

      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          disabled={isRunning}
          className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-lg transition-colors disabled:opacity-50"
        >
          {isRunning ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Synchronizuj
          <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-96 rounded-lg bg-zinc-900 border border-zinc-800 shadow-xl z-30 overflow-hidden">
            {/* MAIN: pełny sync */}
            <button
              onClick={runFullSync}
              className="w-full text-left px-4 py-3 hover:bg-zinc-800 transition-colors border-b border-zinc-800 bg-blue-500/5"
            >
              <div className="flex items-start gap-3">
                <Zap size={14} className="text-blue-400 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-100 font-medium">Pełny sync (rekomendowany)</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Per-sklep dane (14d) → odśwież podglądy → otaguj AI. Trwa 1-2 min.
                  </p>
                </div>
              </div>
            </button>

            {/* Per-account sync */}
            <div className="px-4 py-2 bg-zinc-950/50 border-b border-zinc-800">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wide font-medium">Pobierz dane (per sklep)</p>
            </div>
            {accounts.length === 0 ? (
              <p className="text-xs text-zinc-500 px-4 py-3">Ładowanie listy kont…</p>
            ) : (
              accounts.map(acc => (
                <button
                  key={acc.accountId}
                  onClick={() => runSingle(
                    acc.shop,
                    `/api/etl/meta-ad-sync?days=14&account=${acc.accountId}`,
                    j => `${j.totalRows ?? 0} wierszy, ${j.newCreatives ?? 0} nowych kreacji`,
                    'sync'
                  )}
                  className="w-full text-left px-4 py-2.5 hover:bg-zinc-800 transition-colors border-b border-zinc-800 last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    <Database size={13} className="text-zinc-500" />
                    <span className="text-sm text-zinc-200 font-medium flex-1">{acc.shop}</span>
                    <span className="text-[10px] text-zinc-600 font-mono">{acc.accountId}</span>
                  </div>
                </button>
              ))
            )}

            {/* Inne akcje */}
            <div className="px-4 py-2 bg-zinc-950/50 border-y border-zinc-800">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wide font-medium">Inne</p>
            </div>
            <button
              onClick={() => runSingle(
                'Podglądy',
                '/api/jobs/refresh-thumbnails',
                j => `${j.processed ?? 0} przetworzonych, ${j.failed ?? 0} błędów`,
                'thumbnails'
              )}
              className="w-full text-left px-4 py-2.5 hover:bg-zinc-800 transition-colors border-b border-zinc-800"
            >
              <div className="flex items-start gap-3">
                <ImageIcon size={13} className="text-zinc-500 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 font-medium">Odśwież podglądy</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">100 kreacji, priorytet null thumbnaile, pomija DPA</p>
                </div>
              </div>
            </button>
            <button
              onClick={() => runSingle(
                'AI tagging',
                '/api/jobs/tag-creatives?limit=50',
                j => `${j.succeeded ?? 0} otagowanych, ${j.remaining ?? 0} w kolejce`,
                'tag'
              )}
              className="w-full text-left px-4 py-2.5 hover:bg-zinc-800 transition-colors"
            >
              <div className="flex items-start gap-3">
                <Sparkles size={13} className="text-zinc-500 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 font-medium">Otaguj AI</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">Claude Vision — 50 sztuk</p>
                </div>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

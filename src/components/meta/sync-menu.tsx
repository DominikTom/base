'use client';

import { useState, useEffect, useRef } from 'react';
import { RefreshCw, CheckCircle2, XCircle, ChevronDown, Database, Image as ImageIcon, Sparkles } from 'lucide-react';

type Action = 'sync' | 'thumbnails' | 'tag';

interface ActionConfig {
  key: Action;
  label: string;
  description: string;
  endpoint: string;
  icon: React.ReactNode;
  parseResult: (json: Record<string, unknown>) => string;
}

const ACTIONS: ActionConfig[] = [
  {
    key: 'sync',
    label: 'Pobierz dane (14 dni)',
    description: 'Świeże ad-level metrics z Meta + nowe kreacje',
    endpoint: '/api/etl/meta-ad-sync?days=14',
    icon: <Database size={14} />,
    parseResult: (j) => `${j.totalRows ?? 0} wierszy, ${j.newCreatives ?? 0} nowych kreacji`,
  },
  {
    key: 'thumbnails',
    label: 'Odśwież podglądy (100)',
    description: 'HD thumbnails — fixuje "?" placeholdery na kartach',
    endpoint: '/api/jobs/refresh-thumbnails',
    icon: <ImageIcon size={14} />,
    parseResult: (j) => `${j.processed ?? 0} przetworzonych, ${j.failed ?? 0} błędów`,
  },
  {
    key: 'tag',
    label: 'Otaguj AI (50)',
    description: 'Claude Vision — klasyfikacja stylu/kąta/tonu',
    endpoint: '/api/jobs/tag-creatives?limit=50',
    icon: <Sparkles size={14} />,
    parseResult: (j) => `${j.succeeded ?? 0} otagowanych, ${j.remaining ?? 0} w kolejce`,
  },
];

export function SyncMenu({ onComplete }: { onComplete?: () => void }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<Action | null>(null);
  const [lastResult, setLastResult] = useState<{ action: Action; ok: boolean; msg: string } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Auto-clear toast po 8s
  useEffect(() => {
    if (!lastResult) return;
    const t = setTimeout(() => setLastResult(null), 8000);
    return () => clearTimeout(t);
  }, [lastResult]);

  async function handleAction(action: ActionConfig) {
    setOpen(false);
    setRunning(action.key);
    setLastResult(null);
    try {
      const res = await fetch(action.endpoint, { method: 'POST' });
      const text = await res.text();
      let json: Record<string, unknown>;
      try { json = JSON.parse(text); } catch {
        throw new Error(res.status === 504 ? 'Timeout — spróbuj ponownie' : `HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : `HTTP ${res.status}`);
      setLastResult({ action: action.key, ok: true, msg: action.parseResult(json) });
      onComplete?.();
    } catch (err) {
      setLastResult({
        action: action.key,
        ok: false,
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(null);
    }
  }

  const isRunning = running !== null;
  const runningLabel = running ? ACTIONS.find(a => a.key === running)?.label : '';

  return (
    <div className="flex items-center gap-3">
      {/* Result toast — inline */}
      {lastResult && !isRunning && (
        <span className={`text-xs flex items-center gap-1.5 max-w-[300px] ${lastResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {lastResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          <span className="truncate">{lastResult.msg}</span>
        </span>
      )}
      {isRunning && (
        <span className="text-xs flex items-center gap-1.5 text-zinc-400">
          <RefreshCw size={14} className="animate-spin" />
          {runningLabel}…
        </span>
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
          <div className="absolute right-0 top-full mt-2 w-80 rounded-lg bg-zinc-900 border border-zinc-800 shadow-xl z-30 overflow-hidden">
            {ACTIONS.map(a => (
              <button
                key={a.key}
                onClick={() => handleAction(a)}
                className="w-full text-left px-4 py-3 hover:bg-zinc-800 transition-colors border-b border-zinc-800 last:border-0"
              >
                <div className="flex items-start gap-3">
                  <span className="text-zinc-400 mt-0.5">{a.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-200 font-medium">{a.label}</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{a.description}</p>
                  </div>
                </div>
              </button>
            ))}
            <div className="px-4 py-2 bg-zinc-950/50 border-t border-zinc-800">
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                Crony też lecą codziennie automatycznie. Tu odpalasz manualnie
                gdy chcesz świeższe dane lub naprawić puste podglądy.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

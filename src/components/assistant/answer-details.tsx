'use client';

import { X, Database, BarChart3, LayoutDashboard, Target, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { AnswerMeta, AssistantStep } from '@/lib/assistant/types';

const KIND_ICON = {
  chart: BarChart3,
  widget: LayoutDashboard,
  kpi: Target,
} as const;

const KIND_LABEL = {
  chart: 'Wygenerowano wykres',
  widget: 'Dodano widget na dashboard',
  kpi: 'Dodano definicję KPI',
} as const;

// Popup "Jak to policzono" — pokazuje kroki, które asystent wykonał:
// zapytania SQL (tylko do odczytu) wraz z liczbą wierszy oraz utworzone
// wykresy / widgety / KPI.
export function AnswerDetails({ meta, onClose }: { meta: AnswerMeta; onClose: () => void }) {
  const sqlSteps = meta.steps.filter(s => s.kind === 'sql');
  const actionSteps = meta.steps.filter(s => s.kind !== 'sql');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Jak asystent to policzył</h2>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-300">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <p className="text-xs text-zinc-400 leading-relaxed">
            {sqlSteps.length > 0
              ? `Asystent odpytał bazę danych ${sqlSteps.length}× (tylko do odczytu). Poniżej dokładne zapytania — daty, tabele i metryki są w treści SQL.`
              : 'Ta odpowiedź nie wymagała zapytań do bazy danych.'}
          </p>

          {sqlSteps.map((step, i) => (
            <SqlStep key={i} index={i + 1} step={step} />
          ))}

          {actionSteps.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {actionSteps.map((step, i) => {
                const Icon = KIND_ICON[step.kind as keyof typeof KIND_ICON];
                return (
                  <div key={i} className="flex items-center gap-2 text-xs text-zinc-300">
                    {Icon && <Icon size={14} className="text-emerald-400 shrink-0" />}
                    <span>{KIND_LABEL[step.kind as keyof typeof KIND_LABEL]}{step.label ? `: ${step.label}` : ''}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-zinc-800 shrink-0">
          <p className="text-[11px] text-zinc-600">
            Asystent ma dostęp wyłącznie do odczytu danych analitycznych — nie modyfikuje bazy.
          </p>
        </div>
      </div>
    </div>
  );
}

function SqlStep({ index, step }: { index: number; step: AssistantStep }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/70">
        <span className="text-[11px] font-medium text-zinc-400">Zapytanie {index}</span>
        {step.error ? (
          <span className="flex items-center gap-1 text-[11px] text-red-400">
            <AlertTriangle size={11} /> błąd — ponowiono
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <CheckCircle2 size={11} /> {step.rowCount ?? 0} {rowsLabel(step.rowCount ?? 0)}
          </span>
        )}
      </div>
      <pre className="px-3 py-2 text-[11px] leading-relaxed text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap break-words">
        {(step.sql || '').trim()}
      </pre>
      {step.error && (
        <div className="px-3 py-1.5 text-[11px] text-red-300 border-t border-zinc-800/70 bg-red-950/20">
          {step.error}
        </div>
      )}
    </div>
  );
}

function rowsLabel(n: number): string {
  if (n === 1) return 'wiersz';
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'wiersze';
  return 'wierszy';
}

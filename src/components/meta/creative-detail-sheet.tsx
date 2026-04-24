'use client';

import { useEffect } from 'react';
import { X, Play, Image as ImageIcon, Layers, ExternalLink, Sparkles } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/utils';
import type { CreativeCardData, VideoRetention } from './creative-card';

const INSIGHT_LABELS: Record<string, string> = {
  style: 'Styl',
  angle: 'Kąt',
  tone: 'Ton',
  color_palette: 'Paleta',
  product_focus: 'Produkt',
  has_person: 'Osoba',
  has_text_overlay: 'Tekst nałożony',
  has_pricing: 'Cena widoczna',
};

function RetentionBar({ retention }: { retention: VideoRetention }) {
  const marks = [
    { label: '25%', value: retention.p25 },
    { label: '50%', value: retention.p50 },
    { label: '75%', value: retention.p75 },
    { label: '95%', value: retention.p95 },
    { label: '100%', value: retention.p100 },
  ];
  return (
    <div className="space-y-2">
      {marks.map(m => (
        <div key={m.label} className="flex items-center gap-3 text-xs">
          <span className="w-12 text-zinc-500">{m.label}</span>
          <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full"
              style={{ width: `${Math.min(m.value, 100)}%` }}
            />
          </div>
          <span className="w-12 text-right text-zinc-300 tabular-nums">{m.value.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: 'good' | 'bad' | 'neutral' }) {
  const cls = highlight === 'good' ? 'text-emerald-400' :
              highlight === 'bad' ? 'text-red-400' : 'text-zinc-200';
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5 border-b border-zinc-800/60 last:border-0">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-sm font-medium tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}

function formatInsightValue(key: string, v: unknown): string {
  if (typeof v === 'boolean') return v ? 'Tak' : 'Nie';
  if (typeof v === 'string') return v === 'unknown' ? '—' : v;
  return String(v);
}

export function CreativeDetailSheet({
  creative,
  onClose,
}: {
  creative: CreativeCardData | null;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (creative) {
      window.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [creative, onClose]);

  if (!creative) return null;

  const previewUrl = (creative.image_url && creative.image_url.length > 0)
    ? creative.image_url
    : creative.thumbnail_url;

  const insights = creative.ai_insights as Record<string, unknown> | null;
  const rationale = insights?.rationale as string | undefined;

  const roasHighlight: 'good' | 'bad' | 'neutral' =
    creative.roas >= 3 ? 'good' : creative.roas >= 1 ? 'neutral' : 'bad';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 w-full max-w-lg bg-zinc-950 border-l border-zinc-800 z-50 overflow-y-auto animate-in slide-in-from-right duration-200">
        <div className="sticky top-0 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-5 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2 min-w-0">
            {creative.format === 'video' ? <Play size={14} className="text-purple-400 shrink-0" /> :
             creative.format === 'carousel' ? <Layers size={14} className="text-amber-400 shrink-0" /> :
             <ImageIcon size={14} className="text-blue-400 shrink-0" />}
            <span className="text-sm font-medium text-zinc-200 truncate">
              {creative.title || `Kreacja ${creative.creative_id.slice(-6)}`}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-6">
          {/* Large preview */}
          <div className="bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={creative.title || 'Creative'}
                className="w-full aspect-[4/5] object-contain bg-zinc-950"
              />
            ) : (
              <div className="aspect-[4/5] flex items-center justify-center text-zinc-700">
                <ImageIcon size={48} />
              </div>
            )}
          </div>

          {/* Body copy */}
          {creative.body && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Treść reklamy</h3>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {creative.body.slice(0, 800)}
                {creative.body.length > 800 ? '…' : ''}
              </p>
            </div>
          )}

          {/* Core KPIs */}
          <div>
            <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Wyniki w wybranym okresie</h3>
            <div className="space-y-0">
              <MetricRow label="Spend" value={formatCurrency(creative.spend)} />
              <MetricRow label="Konwersje" value={formatNumber(creative.conversions)} />
              {creative.conversion_value !== undefined && (
                <MetricRow label="Revenue" value={formatCurrency(creative.conversion_value)} />
              )}
              <MetricRow label="ROAS" value={`${creative.roas.toFixed(2)}x`} highlight={roasHighlight} />
              <MetricRow label="CPA" value={creative.cpa && creative.cpa > 0 ? `${creative.cpa.toFixed(2)} zł` : '—'} />
              <MetricRow label="CTR" value={`${creative.ctr.toFixed(2)}%`} />
              <MetricRow label="Impressions" value={formatNumber(creative.impressions)} />
              <MetricRow label="Kliknięcia" value={formatNumber(creative.clicks)} />
              {creative.hook_rate !== undefined && creative.hook_rate > 0 && (
                <MetricRow label="Hook rate (3s/impressions)" value={`${creative.hook_rate.toFixed(2)}%`} />
              )}
            </div>
          </div>

          {/* Video retention */}
          {creative.video_retention && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-3">
                Video retention (% osób oglądających do tego momentu)
              </h3>
              <RetentionBar retention={creative.video_retention} />
              <p className="text-[11px] text-zinc-600 mt-3 leading-relaxed">
                Wskaźnik wyliczany względem 3-sekundowych odtworzeń (hook). Spadek między 25% a 50% =
                komunikat się nie klei; dobra retencja do 75% = wideo skupia uwagę.
              </p>
            </div>
          )}

          {/* AI Insights */}
          {insights && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2 flex items-center gap-1.5">
                <Sparkles size={12} className="text-purple-400" />
                Analiza AI (Claude Vision)
              </h3>
              {rationale && (
                <div className="text-sm text-zinc-300 italic mb-4 p-3 rounded-lg bg-purple-500/5 border-l-2 border-purple-500/50">
                  „{rationale}"
                </div>
              )}
              <div className="space-y-0">
                {Object.entries(INSIGHT_LABELS).map(([key, label]) => {
                  const v = insights[key];
                  if (v === undefined) return null;
                  return (
                    <MetricRow key={key} label={label} value={formatInsightValue(key, v)} />
                  );
                })}
              </div>
            </div>
          )}

          {/* AI Tags flat */}
          {creative.ai_tags.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Wszystkie tagi</h3>
              <div className="flex flex-wrap gap-1.5">
                {creative.ai_tags.map(tag => (
                  <span key={tag} className="text-xs px-2 py-1 rounded-md bg-zinc-800 text-zinc-300">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Meta link */}
          {creative.permalink_url && (
            <a
              href={creative.permalink_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-sm text-zinc-300 transition-colors"
            >
              <ExternalLink size={14} />
              Otwórz post na Facebooku
            </a>
          )}

          {/* Metadata footer */}
          <div className="pt-3 border-t border-zinc-800 text-[11px] text-zinc-600 space-y-1">
            <div>creative_id: <code className="text-zinc-500">{creative.creative_id}</code></div>
            {creative.account_id && <div>account: <code className="text-zinc-500">{creative.account_id}</code></div>}
            {creative.first_seen_at && (
              <div>pierwszy raz: {new Date(creative.first_seen_at).toLocaleDateString('pl-PL')}</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

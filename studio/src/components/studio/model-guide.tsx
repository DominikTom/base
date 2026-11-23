'use client';

import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { Badge } from '@/components/studio/ui';
import { STUDIO_MODELS, type StudioModelMeta } from '@/lib/studio/models';
import { cn } from '@/lib/utils';

type GuideContext = 'generation' | 'edit';

/** Tekst „do czego najlepszy" we właściwym kontekście. */
function bestForIn(m: StudioModelMeta, context: GuideContext): string {
  return context === 'edit' ? (m.editBestFor ?? m.bestFor) : m.bestFor;
}

function isRecommended(m: StudioModelMeta, context: GuideContext): boolean {
  if (!m.recommendedFor) return false;
  return context === 'edit'
    ? m.recommendedFor.includes('edit') || m.recommendedFor.includes('edit-references')
    : m.recommendedFor.includes('generation');
}

/**
 * Rozwijany przewodnik „Który model do czego?" — wspólny dla kreatora
 * (context="generation") i edytora pędzla (context="edit"). Polecane modele
 * na górze, starsze zwinięte na dole listy.
 */
export function ModelGuide({ context, className }: { context: GuideContext; className?: string }) {
  const [open, setOpen] = useState(false);

  const current = STUDIO_MODELS.filter((m) => !m.legacy);
  const legacy = STUDIO_MODELS.filter((m) => m.legacy);
  const ordered = [
    ...current.filter((m) => isRecommended(m, context)),
    ...current.filter((m) => !isRecommended(m, context)),
  ];

  return (
    <div className={className}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-studio-accent-dark transition-colors hover:underline"
      >
        <Info className="h-3.5 w-3.5" />
        Który model do czego?
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-xl border border-studio-border bg-studio-bg p-4">
          {ordered.map((m) => (
            <GuideRow key={m.id} m={m} context={context} />
          ))}
          {legacy.length > 0 && (
            <details className="pt-1">
              <summary className="cursor-pointer text-xs text-studio-muted hover:text-studio-ink">
                Starsze modele ({legacy.length}) — nadal działają, ale nowsze dają lepsze wyniki
              </summary>
              <div className="mt-3 space-y-3">
                {legacy.map((m) => (
                  <GuideRow key={m.id} m={m} context={context} />
                ))}
              </div>
            </details>
          )}
          {context === 'edit' && (
            <p className="border-t border-studio-border pt-3 text-xs text-studio-muted">
              <strong className="text-studio-ink">Natywna maska</strong> (modele OpenAI) = zmienia
              się tylko zamalowany obszar, reszta obrazu zostaje co do piksela.{' '}
              <strong className="text-studio-ink">Technika adnotacji</strong> (modele Google) =
              model widzi zaznaczenie jako wskazówkę — daje najwierniejsze materiały, ale może
              delikatnie dotknąć okolicy zaznaczenia.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GuideRow({ m, context }: { m: StudioModelMeta; context: GuideContext }) {
  const recommended = isRecommended(m, context);
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium text-studio-ink">{m.label}</span>
        <span className="text-studio-muted">({m.vendor})</span>
        {recommended && <Badge tone="accent">polecany</Badge>}
        {context === 'edit' &&
          (m.supportsNativeMask ? <Badge tone="success">natywna maska</Badge> : <Badge>adnotacja</Badge>)}
        {m.supports4K && <Badge>4K</Badge>}
        <Badge>~{m.estimatedSeconds} s</Badge>
      </div>
      <p className="mt-1 leading-relaxed text-studio-muted">{bestForIn(m, context)}</p>
    </div>
  );
}

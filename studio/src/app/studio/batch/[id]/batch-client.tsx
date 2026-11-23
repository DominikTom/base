'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Star } from 'lucide-react';
import { useToast } from '@/components/studio/toast';
import { Badge, Card, PageTitle, Spinner, StatusBadge } from '@/components/studio/ui';
import { apiGet, apiJson } from '@/lib/studio/client';
import { STUDIO_MODELS } from '@/lib/studio/models';
import { cn } from '@/lib/utils';
import type { GenerationView } from '@/lib/studio/types';

/**
 * Porównanie serii: siatka wszystkich generacji z jednego "Generuj serię"
 * (pokoje × modele × warianty), z pollingiem do zakończenia i gwiazdką
 * do oznaczenia najlepszych.
 */
export function BatchClient({ batchId }: { batchId: string }) {
  const { toast } = useToast();
  const [generations, setGenerations] = useState<GenerationView[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<{ generations: GenerationView[] }>(
        `/api/studio/generations?batch=${batchId}&limit=50`
      );
      // Stała kolejność: pokój → model → data (żeby siatka nie skakała).
      setGenerations(
        [...d.generations].sort(
          (a, b) =>
            (a.room_name ?? '').localeCompare(b.room_name ?? '') ||
            a.model.localeCompare(b.model) ||
            a.created_at.localeCompare(b.created_at)
        )
      );
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się pobrać serii.');
    } finally {
      setLoaded(true);
    }
  }, [batchId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = generations.filter((g) => g.status === 'pending').length;

  useEffect(() => {
    if (pendingCount === 0) return;
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
  }, [pendingCount, load]);

  async function toggleFavorite(g: GenerationView) {
    try {
      await apiJson(`/api/studio/generations/${g.id}`, 'PATCH', {
        action: g.is_favorite ? 'unfavorite' : 'favorite',
      });
      setGenerations((prev) =>
        prev.map((x) => (x.id === g.id ? { ...x, is_favorite: !g.is_favorite } : x))
      );
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się oznaczyć.');
    }
  }

  const doneCount = generations.filter((g) => g.status === 'done').length;

  return (
    <div>
      <Link
        href="/studio/library"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-studio-muted transition-colors hover:text-studio-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Biblioteka
      </Link>
      <PageTitle
        title={`Porównanie serii (${generations.length})`}
        subtitle={
          pendingCount > 0
            ? `Gotowe ${doneCount}/${generations.length} — reszta w toku, strona odświeża się sama. Możesz stąd wyjść.`
            : 'Seria ukończona. Oznacz najlepsze gwiazdką — znajdziesz je w bibliotece filtrem „Ulubione".'
        }
      />

      {!loaded ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : generations.length === 0 ? (
        <p className="text-sm text-studio-muted">Nie znaleziono generacji w tej serii.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {generations.map((g) => (
            <Card key={g.id} className="group relative overflow-hidden">
              <Link href={`/studio/generations/${g.id}`} className="block">
                <div className="relative aspect-[4/3] bg-studio-bg">
                  {g.status === 'done' && g.image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`${g.image_url}&w=640`}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      {g.status === 'pending' ? (
                        <Spinner className="h-6 w-6" />
                      ) : (
                        <span className="px-4 text-center text-xs text-red-400 light:text-red-600">
                          {g.error_message?.slice(0, 80) ?? 'Błąd'}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="absolute left-2 top-2">
                    <StatusBadge status={g.status} />
                  </div>
                </div>
                <div className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{g.room_name ?? '—'}</span>
                    <Badge>{STUDIO_MODELS.find((m) => m.id === g.model)?.label ?? g.model}</Badge>
                  </div>
                  {g.image_size === '4K' && <Badge tone="accent">4K</Badge>}
                </div>
              </Link>
              <button
                onClick={() => toggleFavorite(g)}
                title={g.is_favorite ? 'Usuń z ulubionych' : 'Oznacz jako ulubioną'}
                className={cn(
                  'absolute right-2 top-2 rounded-full p-1.5 shadow transition-colors',
                  g.is_favorite
                    ? 'bg-amber-400 text-white'
                    : 'bg-studio-surface/90 text-studio-muted hover:text-amber-400'
                )}
              >
                <Star className={cn('h-4 w-4', g.is_favorite && 'fill-current')} />
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

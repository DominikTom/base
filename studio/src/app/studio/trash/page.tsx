'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useToast } from '@/components/studio/toast';
import { Button, Card, EmptyState, PageTitle, Spinner } from '@/components/studio/ui';
import { apiGet, apiJson, formatDate } from '@/lib/studio/client';
import type { GenerationRow, InspirationSetRow, PackshotRow } from '@/lib/studio/types';

type TrashType = 'generation' | 'packshot' | 'inspiration_set';

interface TrashData {
  generations: (GenerationRow & { image_url: string | null })[];
  packshots: (PackshotRow & { image_url: string })[];
  sets: InspirationSetRow[];
}

export default function TrashPage() {
  const { toast } = useToast();
  const [data, setData] = useState<TrashData | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<TrashData>('/api/studio/trash'));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się pobrać kosza.');
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRestore(type: TrashType, id: string) {
    setBusyId(id);
    try {
      await apiJson('/api/studio/trash', 'POST', { type, id });
      toast('success', 'Przywrócono.');
      await load();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Przywracanie nie powiodło się.');
    } finally {
      setBusyId(null);
    }
  }

  async function handlePurge(type: TrashType, id: string) {
    if (!window.confirm('Trwale usunąć ten element wraz z plikami? Tej operacji nie można cofnąć.')) {
      return;
    }
    setBusyId(id);
    try {
      await apiJson('/api/studio/trash', 'DELETE', { type, id });
      toast('success', 'Usunięto trwale.');
      await load();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Usuwanie nie powiodło się.');
    } finally {
      setBusyId(null);
    }
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const empty =
    data.generations.length === 0 && data.packshots.length === 0 && data.sets.length === 0;

  return (
    <div>
      <PageTitle
        title="Kosz"
        subtitle="Elementy są usuwane trwale automatycznie po 30 dniach."
      />

      {empty ? (
        <EmptyState icon={<Trash2 className="h-10 w-10" />} title="Kosz jest pusty" />
      ) : (
        <div className="space-y-8">
          {data.generations.length > 0 && (
            <TrashSection title="Wizualizacje">
              {data.generations.map((g) => (
                <TrashCard
                  key={g.id}
                  imageUrl={g.image_url}
                  title={g.edit_instruction ? 'Edycja pędzlem' : 'Wizualizacja'}
                  subtitle={`usunięto ${formatDate(g.deleted_at)}`}
                  busy={busyId === g.id}
                  onRestore={() => handleRestore('generation', g.id)}
                  onPurge={() => handlePurge('generation', g.id)}
                />
              ))}
            </TrashSection>
          )}
          {data.packshots.length > 0 && (
            <TrashSection title="Packshoty">
              {data.packshots.map((p) => (
                <TrashCard
                  key={p.id}
                  imageUrl={p.image_url}
                  title={p.original_filename ?? 'Packshot'}
                  subtitle={`usunięto ${formatDate(p.deleted_at)}`}
                  busy={busyId === p.id}
                  onRestore={() => handleRestore('packshot', p.id)}
                  onPurge={() => handlePurge('packshot', p.id)}
                />
              ))}
            </TrashSection>
          )}
          {data.sets.length > 0 && (
            <TrashSection title="Zestawy inspiracji">
              {data.sets.map((s) => (
                <TrashCard
                  key={s.id}
                  imageUrl={null}
                  title={s.name}
                  subtitle={`usunięto ${formatDate(s.deleted_at)}`}
                  busy={busyId === s.id}
                  onRestore={() => handleRestore('inspiration_set', s.id)}
                  onPurge={() => handlePurge('inspiration_set', s.id)}
                />
              ))}
            </TrashSection>
          )}
        </div>
      )}
    </div>
  );
}

function TrashSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-studio-muted">
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">{children}</div>
    </section>
  );
}

function TrashCard({
  imageUrl,
  title,
  subtitle,
  busy,
  onRestore,
  onPurge,
}: {
  imageUrl: string | null;
  title: string;
  subtitle: string;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="aspect-[4/3] bg-studio-bg">
        {imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={imageUrl} alt="" className="h-full w-full object-cover opacity-60" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-studio-muted">
            <Trash2 className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="text-xs text-studio-muted">{subtitle}</p>
        <div className="flex gap-1.5">
          <Button variant="secondary" onClick={onRestore} disabled={busy} className="flex-1 px-2 py-1.5 text-xs">
            <RotateCcw className="h-3.5 w-3.5" /> Przywróć
          </Button>
          <Button variant="danger" onClick={onPurge} disabled={busy} className="px-2 py-1.5 text-xs">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

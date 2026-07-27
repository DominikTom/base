'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { MaskEditor, type MaskEditorSubmit } from '@/components/studio/mask-editor';
import { useToast } from '@/components/studio/toast';
import { PageTitle, Spinner } from '@/components/studio/ui';
import { apiGet, apiJson } from '@/lib/studio/client';
import { getBrowserUserId, uploadToStorageFromBrowser } from '@/lib/studio/supabase-browser';
import type { GenerationRow, PackshotRow } from '@/lib/studio/types';

export function EditorClient({
  sourceType,
  sourceId,
}: {
  sourceType: 'generation' | 'packshot';
  sourceId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('Edycja pędzlem');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!sourceId) throw new Error('Brak identyfikatora obrazu.');
        if (sourceType === 'generation') {
          const d = await apiGet<{ generation: GenerationRow & { image_url: string | null } }>(
            `/api/studio/generations/${sourceId}`
          );
          if (!d.generation.image_url) throw new Error('Ta wizualizacja nie ma jeszcze obrazu.');
          setImageUrl(d.generation.image_url);
          setTitle('Edycja wizualizacji pędzlem');
        } else {
          const d = await apiGet<{ packshots: (PackshotRow & { image_url: string })[] }>(
            '/api/studio/packshots'
          );
          const pk = d.packshots.find((p) => p.id === sourceId);
          if (!pk) throw new Error('Nie znaleziono packshota.');
          setImageUrl(pk.image_url);
          setTitle(`Edycja packshota${pk.original_filename ? ` — ${pk.original_filename}` : ''}`);
        }
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Nie udało się załadować obrazu.');
      } finally {
        setLoading(false);
      }
    })();
  }, [sourceType, sourceId, toast]);

  async function handleSubmit(payload: MaskEditorSubmit) {
    setBusy(true);
    try {
      // Maska + annotacja idą z przeglądarki prosto do Storage (RLS) —
      // omijamy limit 4,5 MB body na funkcjach Vercela.
      const userId = await getBrowserUserId();
      const maskPath = `masks/${userId}/${crypto.randomUUID()}-mask.png`;
      const annotatedPath = maskPath.replace(/-mask\.png$/, '-annotated.png');
      await Promise.all([
        uploadToStorageFromBrowser('generations', maskPath, payload.mask, 'image/png'),
        uploadToStorageFromBrowser('generations', annotatedPath, payload.annotated, 'image/png'),
      ]);

      const res = await apiJson<{ generation: GenerationRow }>('/api/studio/edits', 'POST', {
        sourceType,
        sourceId,
        instruction: payload.instruction,
        model: payload.model,
        maskPath,
        async: true,
      });
      router.push(`/studio/generations/${res.generation.id}`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się rozpocząć edycji.');
      setBusy(false);
    }
  }

  return (
    <div>
      <Link
        href={sourceType === 'generation' ? `/studio/generations/${sourceId}` : '/studio/new'}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-studio-muted transition-colors hover:text-studio-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Wróć
      </Link>
      <PageTitle
        title={title}
        subtitle="Zaznacz pędzlem obszar do zmiany i opisz, co ma się w nim stać. Reszta obrazu pozostanie nietknięta."
      />
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : imageUrl ? (
        <MaskEditor imageUrl={imageUrl} onSubmit={handleSubmit} busy={busy} />
      ) : (
        <p className="text-sm text-studio-muted">Nie udało się załadować obrazu.</p>
      )}
    </div>
  );
}

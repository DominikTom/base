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
import { STUDIO_MODELS, type StudioModelId } from '@/lib/studio/models';
import type { GenerationRow, PackshotRow } from '@/lib/studio/types';

export function EditorClient({
  sourceType,
  sourceId,
  reuseId = null,
}: {
  sourceType: 'generation' | 'packshot';
  sourceId: string;
  /** Id wcześniejszej edycji — jej maska i instrukcja stają się punktem wyjścia. */
  reuseId?: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('Edycja pędzlem');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [initialMaskUrl, setInitialMaskUrl] = useState<string | undefined>(undefined);
  const [initialInstruction, setInitialInstruction] = useState<string | undefined>(undefined);
  const [initialModel, setInitialModel] = useState<string | undefined>(undefined);

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

        // „Popraw maskę": maska + instrukcja + model z poprzedniej edycji.
        if (reuseId) {
          try {
            const r = await apiGet<{ generation: GenerationRow }>(`/api/studio/generations/${reuseId}`);
            const prev = r.generation;
            if (prev.mask_storage_path) {
              setInitialMaskUrl(
                `/api/studio/file?b=generations&p=${encodeURIComponent(prev.mask_storage_path)}`
              );
            }
            if (prev.edit_instruction) setInitialInstruction(prev.edit_instruction);
            if (prev.model) setInitialModel(prev.model);
            setTitle('Poprawka maski — na bazie poprzedniej edycji');
          } catch {
            toast('error', 'Nie udało się wczytać poprzedniej maski — zaczynasz od czystej.');
          }
        }
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Nie udało się załadować obrazu.');
      } finally {
        setLoading(false);
      }
    })();
  }, [sourceType, sourceId, reuseId, toast]);

  async function handleSubmit(payload: MaskEditorSubmit) {
    setBusy(true);
    try {
      // Maska + annotacja idą z przeglądarki prosto do Storage (RLS) —
      // omijamy limit 4,5 MB body na funkcjach Vercela.
      const userId = await getBrowserUserId();
      const maskPath = `masks/${userId}/${crypto.randomUUID()}-mask.png`;
      const annotatedPath = maskPath.replace(/-mask\.png$/, '-annotated.png');
      const referencePaths = payload.references.map((f, i) => {
        const ext = f.type === 'image/jpeg' ? 'jpg' : f.type === 'image/webp' ? 'webp' : 'png';
        return `edit-refs/${userId}/${crypto.randomUUID()}-${i}.${ext}`;
      });
      await Promise.all([
        uploadToStorageFromBrowser('generations', maskPath, payload.mask, 'image/png'),
        uploadToStorageFromBrowser('generations', annotatedPath, payload.annotated, 'image/png'),
        ...payload.references.map((f, i) =>
          uploadToStorageFromBrowser('generations', referencePaths[i], f, f.type)
        ),
      ]);

      const res = await apiJson<{ generation: GenerationRow }>('/api/studio/edits', 'POST', {
        sourceType,
        sourceId,
        instruction: payload.instruction || undefined,
        model: payload.model,
        maskPath,
        referencePaths: referencePaths.length > 0 ? referencePaths : undefined,
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
        <MaskEditor
          key={`${imageUrl}-${initialMaskUrl ?? ''}`}
          imageUrl={imageUrl}
          onSubmit={handleSubmit}
          busy={busy}
          initialMaskUrl={initialMaskUrl}
          initialInstruction={initialInstruction}
          defaultModel={
            initialModel && STUDIO_MODELS.some((m) => m.id === initialModel)
              ? (initialModel as StudioModelId)
              : undefined
          }
        />
      ) : (
        <p className="text-sm text-studio-muted">Nie udało się załadować obrazu.</p>
      )}
    </div>
  );
}

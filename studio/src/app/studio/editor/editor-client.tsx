'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Brush, Eraser, Images, SlidersHorizontal } from 'lucide-react';
import { AdjustEditor } from '@/components/studio/adjust-editor';
import { MaskEditor, type MaskEditorSubmit } from '@/components/studio/mask-editor';
import { useToast } from '@/components/studio/toast';
import { Card, EmptyState, PageTitle, Spinner } from '@/components/studio/ui';
import { apiGet, apiJson } from '@/lib/studio/client';
import { getBrowserUserId, uploadToStorageFromBrowser } from '@/lib/studio/supabase-browser';
import { STUDIO_MODELS, type StudioModelId } from '@/lib/studio/models';
import type { GenerationRow, GenerationView, PackshotRow } from '@/lib/studio/types';

export type EditorTab = 'brush' | 'remove' | 'adjust';

const TABS: { id: EditorTab; label: string; icon: typeof Brush; hint: string }[] = [
  { id: 'brush', label: 'Pędzel AI', icon: Brush, hint: 'Zaznacz obszar i opisz zmianę albo wstaw produkt z referencji.' },
  { id: 'remove', label: 'Usuń obiekt', icon: Eraser, hint: 'Zamaluj przedmioty do usunięcia — model odtworzy tło.' },
  { id: 'adjust', label: 'Korekty', icon: SlidersHorizontal, hint: 'Suwaki jak w Photoshopie: jasność, kontrast, temperatura, filtry i presety.' },
];

export function EditorClient({
  sourceType,
  sourceId,
  reuseId = null,
  initialTab = 'brush',
}: {
  sourceType: 'generation' | 'packshot';
  sourceId: string;
  /** Id wcześniejszej edycji — jej maska i instrukcja stają się punktem wyjścia. */
  reuseId?: string | null;
  initialTab?: EditorTab;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<EditorTab>(reuseId ? 'brush' : initialTab);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('Edycja');
  const [loading, setLoading] = useState(Boolean(sourceId));
  const [busy, setBusy] = useState(false);
  const [initialMaskUrl, setInitialMaskUrl] = useState<string | undefined>(undefined);
  const [initialInstruction, setInitialInstruction] = useState<string | undefined>(undefined);
  const [initialModel, setInitialModel] = useState<string | undefined>(undefined);

  // Zakładka w URL — odświeżenie i udostępnienie linku wraca w to samo miejsce.
  function switchTab(next: EditorTab) {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', next);
    window.history.replaceState(null, '', `?${params.toString()}`);
  }

  useEffect(() => {
    if (!sourceId) return;
    (async () => {
      try {
        if (sourceType === 'generation') {
          const d = await apiGet<{ generation: GenerationRow & { image_url: string | null } }>(
            `/api/studio/generations/${sourceId}`
          );
          if (!d.generation.image_url) throw new Error('Ta wizualizacja nie ma jeszcze obrazu.');
          setImageUrl(d.generation.image_url);
          setTitle('Edycja wizualizacji');
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

  const handleMaskSubmit = useCallback(
    async (payload: MaskEditorSubmit) => {
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
    },
    [sourceType, sourceId, router, toast]
  );

  // Bez wskazanego obrazu (wejście z menu "Edycja") — wybór źródła.
  if (!sourceId) {
    return <SourcePicker tab={tab} />;
  }

  const activeTab = TABS.find((t) => t.id === tab)!;

  return (
    <div>
      <Link
        href={sourceType === 'generation' ? `/studio/generations/${sourceId}` : '/studio/packshots'}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-studio-muted transition-colors hover:text-studio-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Wróć
      </Link>
      <PageTitle title={title} subtitle={activeTab.hint} />

      {/* Zakładki narzędzi */}
      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-studio-border bg-studio-surface p-1 sm:inline-flex">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-initial ${
              tab === t.id
                ? 'bg-studio-accent text-white'
                : 'text-studio-muted hover:bg-studio-bg hover:text-studio-ink'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : imageUrl ? (
        tab === 'adjust' ? (
          <AdjustEditor imageUrl={imageUrl} sourceType={sourceType} sourceId={sourceId} />
        ) : (
          <MaskEditor
            key={`${tab}-${imageUrl}-${initialMaskUrl ?? ''}`}
            imageUrl={imageUrl}
            onSubmit={handleMaskSubmit}
            busy={busy}
            mode={tab === 'remove' ? 'remove' : 'edit'}
            initialMaskUrl={tab === 'brush' ? initialMaskUrl : undefined}
            initialInstruction={tab === 'brush' ? initialInstruction : undefined}
            defaultModel={
              initialModel && STUDIO_MODELS.some((m) => m.id === initialModel)
                ? (initialModel as StudioModelId)
                : undefined
            }
          />
        )
      ) : (
        <p className="text-sm text-studio-muted">Nie udało się załadować obrazu.</p>
      )}
    </div>
  );
}

/** Wybór obrazu do edycji: ostatnie wizualizacje + packshoty. */
function SourcePicker({ tab }: { tab: EditorTab }) {
  const router = useRouter();
  const [generations, setGenerations] = useState<GenerationView[]>([]);
  const [packshots, setPackshots] = useState<(PackshotRow & { image_url: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet<{ generations: GenerationView[] }>('/api/studio/generations?status=done&limit=24'),
      apiGet<{ packshots: (PackshotRow & { image_url: string })[] }>('/api/studio/packshots?limit=24'),
    ])
      .then(([g, p]) => {
        setGenerations(g.generations.filter((x) => x.image_url));
        setPackshots(p.packshots);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function open(type: 'generation' | 'packshot', id: string) {
    router.push(`/studio/editor?type=${type}&id=${id}&tab=${tab}`);
  }

  return (
    <div>
      <PageTitle
        title="Edycja"
        subtitle="Wybierz obraz do pracy — pędzel AI, usuwanie obiektów albo korekty suwakami."
      />
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : generations.length === 0 && packshots.length === 0 ? (
        <EmptyState
          icon={<Images className="h-10 w-10" />}
          title="Brak obrazów do edycji"
          hint="Wygeneruj wizualizację albo wgraj packshot — wtedy pojawią się tutaj."
        />
      ) : (
        <div className="space-y-8">
          {generations.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-studio-muted">
                Ostatnie wizualizacje
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
                {generations.map((g) => (
                  <Card
                    key={g.id}
                    onClick={() => open('generation', g.id)}
                    className="group cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
                  >
                    <div className="aspect-[4/3] bg-studio-bg">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`${g.image_url}&w=320`}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                    </div>
                    <p className="truncate p-2 text-xs text-studio-muted">
                      {g.room_name ?? (g.edit_instruction ? 'Edycja' : 'Wizualizacja')}
                    </p>
                  </Card>
                ))}
              </div>
            </section>
          )}
          {packshots.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-studio-muted">
                Packshoty
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
                {packshots.map((p) => (
                  <Card
                    key={p.id}
                    onClick={() => open('packshot', p.id)}
                    className="group cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
                  >
                    <div className="aspect-square bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`${p.image_url}&w=320`}
                        alt={p.original_filename ?? 'packshot'}
                        className="h-full w-full object-contain p-2"
                        loading="lazy"
                      />
                    </div>
                    <p className="truncate p-2 text-xs text-studio-muted">
                      {p.original_filename ?? 'Bez nazwy'}
                    </p>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

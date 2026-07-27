'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Brush,
  Copy,
  Download,
  Layers,
  Lightbulb,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { BeforeAfterSlider } from '@/components/studio/before-after-slider';
import { Lightbox } from '@/components/studio/lightbox';
import { useToast } from '@/components/studio/toast';
import { Badge, Button, Card, Spinner, StatusBadge, labelForStrength } from '@/components/studio/ui';
import { apiGet, apiJson, formatDate, formatDuration } from '@/lib/studio/client';
import { STUDIO_MODELS } from '@/lib/studio/models';
import { cn } from '@/lib/utils';
import type { GenerationRow } from '@/lib/studio/types';

type GenerationDetail = GenerationRow & {
  image_url: string | null;
  room_name: string | null;
  set_name: string | null;
  author_name: string | null;
};

interface DetailResponse {
  generation: GenerationDetail;
  packshot: { id: string; image_url: string; original_filename: string | null } | null;
  packshots?: {
    id: string;
    role: 'main' | 'addition';
    image_url: string;
    original_filename: string | null;
  }[];
  tree: (GenerationRow & { image_url: string | null })[];
}

interface SetOption {
  id: string;
  name: string;
}

export function GenerationDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showCompare, setShowCompare] = useState(true);
  const [sets, setSets] = useState<SetOption[]>([]);
  const [addingToSet, setAddingToSet] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<DetailResponse>(`/api/studio/generations/${id}`);
      setData(d);
      setError(null);
      return d;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać wizualizacji.');
      return null;
    }
  }, [id]);

  // Polling przy statusie pending (generacje są asynchroniczne).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await load();
      if (!d || cancelled) return;
      if (d.generation.status === 'pending') {
        pollRef.current = window.setInterval(async () => {
          const nd = await load();
          if (nd && nd.generation.status !== 'pending' && pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }, 3000);
      }
    })();
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [load]);

  useEffect(() => {
    apiGet<{ sets: SetOption[] }>('/api/studio/inspirations')
      .then((d) => setSets(d.sets))
      .catch(() => {});
  }, []);

  if (error) {
    return (
      <div>
        <BackLink />
        <p className="mt-8 text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const g = data.generation;
  const modelMeta = STUDIO_MODELS.find((m) => m.id === g.model);
  const isEdit = Boolean(g.edit_instruction);
  const parent = data.tree.find((t) => t.id === g.parent_generation_id);

  async function handleTrash() {
    try {
      await apiJson(`/api/studio/generations/${g.id}`, 'PATCH', { action: 'trash' });
      toast('success', 'Przeniesiono do kosza.');
      router.push('/studio/library');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się usunąć.');
    }
  }

  async function handleRetry() {
    try {
      await apiJson(`/api/studio/generations/${g.id}/retry`, 'POST', {});
      toast('info', 'Ponawiam generację…');
      await load();
      // wznowienie pollingu
      if (!pollRef.current) {
        pollRef.current = window.setInterval(async () => {
          const nd = await load();
          if (nd && nd.generation.status !== 'pending' && pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }, 3000);
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się ponowić.');
    }
  }

  async function handleRegenerate() {
    // "Generuj ponownie z tymi ustawieniami" — nowa generacja, te same parametry.
    try {
      const res = await apiJson<{ generation: GenerationRow }>('/api/studio/generations', 'POST', {
        packshots: data?.packshots?.length
          ? data.packshots.map(({ id, role }) => ({ id, role }))
          : g.packshot_id
            ? [{ id: g.packshot_id, role: 'main' }]
            : [],
        roomId: g.room_id,
        styleText: g.style_text ?? undefined,
        inspirationSetId: g.inspiration_set_id,
        inspirationStrength: g.inspiration_strength ?? undefined,
        manualNotes: g.manual_notes ?? undefined,
        model: g.model,
        async: true,
      });
      router.push(`/studio/generations/${res.generation.id}`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się rozpocząć generacji.');
    }
  }

  async function handleCopyToClipboard() {
    if (!g.image_url) return;
    try {
      const blob = await (await fetch(g.image_url)).blob();
      const png = blob.type === 'image/png' ? blob : await convertToPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('success', 'Skopiowano obraz do schowka.');
    } catch {
      toast('error', 'Kopiowanie do schowka nie powiodło się w tej przeglądarce.');
    }
  }

  async function handleAddToSet(setId: string) {
    setAddingToSet(true);
    try {
      await apiJson(`/api/studio/inspirations/${setId}/add-generation`, 'POST', {
        generationId: g.id,
      });
      toast('success', 'Dodano do zestawu inspiracji.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się dodać do zestawu.');
    } finally {
      setAddingToSet(false);
    }
  }

  return (
    <div>
      <BackLink />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isEdit ? 'Edycja pędzlem' : 'Wizualizacja'}
          </h1>
          <StatusBadge status={g.status} />
          {isEdit && <Badge tone="accent">wersja edytowana</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {g.status === 'done' && g.image_url && (
            <>
              <Button variant="secondary" onClick={() => router.push(`/studio/editor?type=generation&id=${g.id}`)}>
                <Brush className="h-4 w-4" /> Edytuj pędzlem
              </Button>
              <a href={`${g.image_url}&download=1`}>
                <Button variant="secondary">
                  <Download className="h-4 w-4" /> Pobierz PNG
                </Button>
              </a>
              <Button variant="secondary" onClick={handleCopyToClipboard}>
                <Copy className="h-4 w-4" /> Kopiuj
              </Button>
            </>
          )}
          {!isEdit && g.packshot_id && g.room_id && (
            <>
              <Button variant="secondary" onClick={handleRegenerate}>
                <RefreshCw className="h-4 w-4" /> Generuj ponownie
              </Button>
              <Link href={`/studio/new?from=${g.id}`}>
                <Button variant="secondary">
                  <Sparkles className="h-4 w-4" /> Duplikuj ustawienia i zmień
                </Button>
              </Link>
            </>
          )}
          <Button variant="ghost" onClick={handleTrash} title="Przenieś do kosza">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Obraz / skeleton / błąd */}
        <div className="space-y-4">
          {g.status === 'pending' && (
            <Card className="flex aspect-[4/3] animate-pulse flex-col items-center justify-center gap-3">
              <Spinner className="h-10 w-10" />
              <p className="text-sm font-medium text-studio-ink">Generuję wizualizację…</p>
              <p className="text-xs text-studio-muted">
                Szacowany czas: ~{modelMeta?.estimatedSeconds ?? 40} s. Możesz wyjść z tej strony —
                status znajdziesz w Bibliotece.
              </p>
            </Card>
          )}
          {g.status === 'error' && (
            <Card className="flex aspect-[4/3] flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="font-medium text-red-700">Generacja nie powiodła się</p>
              <p className="max-w-md text-sm text-studio-muted">{g.error_message}</p>
              <Button onClick={handleRetry}>
                <RefreshCw className="h-4 w-4" /> Spróbuj ponownie
              </Button>
            </Card>
          )}
          {g.status === 'done' && g.image_url && (
            <>
              {isEdit && parent?.image_url && showCompare ? (
                <BeforeAfterSlider beforeUrl={parent.image_url} afterUrl={g.image_url} />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={g.image_url}
                  alt="Wizualizacja"
                  className="w-full cursor-zoom-in rounded-xl"
                  onClick={() => setLightboxOpen(true)}
                />
              )}
              {lightboxOpen && g.image_url && (
                <Lightbox
                  imageUrl={g.image_url}
                  downloadUrl={`${g.image_url}&download=1`}
                  onClose={() => setLightboxOpen(false)}
                />
              )}
              {isEdit && parent?.image_url && (
                <button
                  onClick={() => setShowCompare((v) => !v)}
                  className="text-sm text-studio-accent-dark underline-offset-2 hover:underline"
                >
                  {showCompare ? 'Pokaż tylko wynik' : 'Porównaj przed / po'}
                </button>
              )}
            </>
          )}
        </div>

        {/* Kontekst generacji */}
        <div className="space-y-4">
          <Card className="space-y-3 p-5 text-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-studio-muted">
              Kontekst generacji
            </h2>
            {(data.packshots?.length ?? 0) > 0 && (
              <div>
                <p className="mb-2 font-medium">
                  {data.packshots!.length === 1 ? 'Packshot źródłowy' : `Packshoty źródłowe (${data.packshots!.length})`}
                </p>
                <div className="space-y-2">
                  {data.packshots!.map((pk) => (
                    <div key={pk.id} className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={pk.image_url}
                        alt="Packshot"
                        className="h-12 w-12 rounded-lg border border-studio-border bg-white object-contain"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Badge tone={pk.role === 'main' ? 'accent' : 'neutral'}>
                            {pk.role === 'main' ? 'główny' : 'dodatek'}
                          </Badge>
                        </div>
                        <p className="truncate text-xs text-studio-muted">
                          {pk.original_filename ?? '—'}
                        </p>
                        <Link
                          href={`/studio/editor?type=packshot&id=${pk.id}`}
                          className="text-xs text-studio-accent-dark hover:underline"
                        >
                          edytuj pędzlem
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <InfoRow label="Pokój" value={g.room_name ?? '—'} />
            <InfoRow label="Model" value={modelMeta?.label ?? g.model} />
            {g.style_text && <InfoRow label="Styl" value={g.style_text} />}
            {g.set_name && (
              <InfoRow
                label="Inspiracje"
                value={`${g.set_name}${g.inspiration_strength ? ` · siła ${g.inspiration_strength} (${labelForStrength(g.inspiration_strength)})` : ''}`}
              />
            )}
            {g.manual_notes && <InfoRow label="Uwagi" value={g.manual_notes} />}
            {g.edit_instruction && <InfoRow label="Instrukcja edycji" value={g.edit_instruction} />}
            {(g.edit_reference_paths?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1 text-xs text-studio-muted">Referencje edycji</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.edit_reference_paths!.map((p) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      key={p}
                      src={`/api/studio/file?b=generations&p=${encodeURIComponent(p)}`}
                      alt="Referencja"
                      className="h-12 w-12 rounded-lg border border-studio-border bg-white object-contain"
                    />
                  ))}
                </div>
              </div>
            )}
            <InfoRow label="Autor" value={g.author_name ?? '—'} />
            <InfoRow label="Data" value={formatDate(g.created_at)} />
            <InfoRow label="Czas generacji" value={formatDuration(g.duration_ms)} />
            {g.width && g.height && (
              <InfoRow label="Rozdzielczość" value={`${g.width} × ${g.height}px`} />
            )}
            {g.full_prompt_sent && (
              <div>
                <button
                  onClick={() => setShowPrompt((v) => !v)}
                  className="text-xs text-studio-accent-dark hover:underline"
                >
                  {showPrompt ? 'Ukryj pełny prompt' : 'Pokaż pełny prompt wysłany do modelu'}
                </button>
                {showPrompt && (
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-studio-bg p-3 text-xs text-studio-muted">
                    {g.full_prompt_sent}
                  </pre>
                )}
              </div>
            )}
          </Card>

          {/* Dodaj do inspiracji */}
          {g.status === 'done' && sets.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-studio-muted">
                <Lightbulb className="h-3.5 w-3.5" /> Dodaj do inspiracji
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {sets.map((s) => (
                  <button
                    key={s.id}
                    disabled={addingToSet}
                    onClick={() => handleAddToSet(s.id)}
                    className="rounded-full border border-studio-border px-3 py-1 text-xs transition-colors hover:border-studio-accent hover:bg-studio-accent-soft disabled:opacity-50"
                  >
                    + {s.name}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Drzewo wersji */}
          {data.tree.length > 1 && (
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-studio-muted">
                <Layers className="h-3.5 w-3.5" /> Drzewo wersji
              </h2>
              <VersionTree tree={data.tree} currentId={g.id} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/studio/library"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-studio-muted transition-colors hover:text-studio-ink"
    >
      <ArrowLeft className="h-4 w-4" /> Biblioteka
    </Link>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-xs text-studio-muted">{label}</span>
      <span className="text-right text-sm">{value}</span>
    </div>
  );
}

function VersionTree({
  tree,
  currentId,
}: {
  tree: (GenerationRow & { image_url: string | null })[];
  currentId: string;
}) {
  const byParent = new Map<string | null, typeof tree>();
  for (const node of tree) {
    const key = node.parent_generation_id;
    const list = byParent.get(key) ?? [];
    list.push(node);
    byParent.set(key, list);
  }
  const root = tree.find((t) => !tree.some((o) => o.id === t.parent_generation_id));

  function renderNode(node: (typeof tree)[number], depth: number): React.ReactNode {
    const children = byParent.get(node.id) ?? [];
    return (
      <div key={node.id} style={{ marginLeft: depth * 16 }}>
        <Link
          href={`/studio/generations/${node.id}`}
          className={cn(
            'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-studio-bg',
            node.id === currentId && 'bg-studio-accent-soft font-medium'
          )}
        >
          {node.image_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={node.image_url} alt="" className="h-8 w-8 rounded object-cover" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded bg-studio-bg">
              <Spinner className="h-3 w-3" />
            </span>
          )}
          <span className="flex-1 truncate">
            {node.edit_instruction
              ? `Edycja: ${node.edit_instruction.slice(0, 40)}${node.edit_instruction.length > 40 ? '…' : ''}`
              : 'Generacja bazowa'}
          </span>
          <span className="text-xs text-studio-muted">{formatDate(node.created_at).slice(0, 10)}</span>
        </Link>
        {children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  }

  if (!root) return null;
  return <div className="space-y-0.5">{renderNode(root, 0)}</div>;
}

/** Konwersja do PNG dla ClipboardItem (schowek przyjmuje tylko PNG). */
async function convertToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  );
}

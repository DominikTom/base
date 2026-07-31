'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ImagePlus, Sparkles } from 'lucide-react';
import { RoomIcon } from '@/components/studio/room-icon';
import { useToast } from '@/components/studio/toast';
import { Badge, Button, Card, PageTitle, Spinner, labelForStrength } from '@/components/studio/ui';
import { apiGet, apiJson } from '@/lib/studio/client';
import {
  getBrowserUserId,
  readImageDimensions,
  uploadToStorageFromBrowser,
} from '@/lib/studio/supabase-browser';
import { DEFAULT_GENERATION_MODEL, STUDIO_MODELS, type StudioModelId } from '@/lib/studio/models';
import { cn } from '@/lib/utils';
import {
  ASPECT_RATIOS,
  DEFAULT_ASPECT_RATIO,
  MAX_PACKSHOTS_PER_GENERATION,
  type AspectRatio,
  type GenerationRow,
  type InspirationSetRow,
  type PackshotRole,
  type PackshotRow,
  type RoomRow,
} from '@/lib/studio/types';

interface PackshotItem extends PackshotRow {
  image_url: string;
}
interface SetItem extends InspirationSetRow {
  room_name: string | null;
  image_count: number;
  cover_url: string | null;
}

export default function NewVisualizationPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [packshots, setPackshots] = useState<PackshotItem[]>([]);
  const [sets, setSets] = useState<SetItem[]>([]);
  const [loading, setLoading] = useState(true);

  /** Wybrane packshoty w kolejności klikania; pierwszy automatycznie = główny. */
  const [selectedPackshots, setSelectedPackshots] = useState<
    { id: string; role: PackshotRole; note: string }[]
  >([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [styleText, setStyleText] = useState('');
  const [setId, setSetId] = useState<string | null>(null);
  const [strength, setStrength] = useState(3);
  const [notes, setNotes] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(DEFAULT_ASPECT_RATIO);
  const [model, setModel] = useState<StudioModelId>(DEFAULT_GENERATION_MODEL);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [r, p, s] = await Promise.all([
          apiGet<{ rooms: RoomRow[] }>('/api/studio/rooms'),
          apiGet<{ packshots: PackshotItem[] }>('/api/studio/packshots'),
          apiGet<{ sets: SetItem[] }>('/api/studio/inspirations'),
        ]);
        setRooms(r.rooms);
        setPackshots(p.packshots);
        setSets(s.sets);

        // Duplikacja ustawień: /studio/new?from=<id generacji>
        const from = new URLSearchParams(window.location.search).get('from');
        if (from) {
          const d = await apiGet<{
            generation: GenerationRow;
            packshots?: { id: string; role: PackshotRole; note: string | null }[];
          }>(`/api/studio/generations/${from}`);
          const g = d.generation;
          if (d.packshots?.length) {
            setSelectedPackshots(
              d.packshots.map(({ id, role, note }) => ({ id, role, note: note ?? '' }))
            );
          } else if (g.packshot_id) {
            setSelectedPackshots([{ id: g.packshot_id, role: 'main', note: '' }]);
          }
          if (g.room_id) setRoomId(g.room_id);
          setStyleText(g.style_text ?? '');
          setSetId(g.inspiration_set_id);
          if (g.inspiration_strength) setStrength(g.inspiration_strength);
          setNotes(g.manual_notes ?? '');
          if (g.aspect_ratio && ASPECT_RATIOS.some((a) => a.id === g.aspect_ratio)) {
            setAspectRatio(g.aspect_ratio as AspectRatio);
          }
          if (STUDIO_MODELS.some((m) => m.id === g.model)) setModel(g.model as StudioModelId);
        }
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Nie udało się załadować danych.');
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (file.size > 20 * 1024 * 1024) {
        toast('error', 'Plik jest za duży — limit to 20 MB.');
        return;
      }
      const allowed = ['image/png', 'image/jpeg', 'image/webp'];
      if (!allowed.includes(file.type)) {
        toast('error', 'Nieobsługiwany format. Dozwolone: PNG, JPG, WEBP.');
        return;
      }
      setUploading(true);
      try {
        // Upload prosto do Storage (RLS) — omija limit 4,5 MB body Vercela.
        const dims = await readImageDimensions(file);
        const userId = await getBrowserUserId();
        const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png';
        const path = `${userId}/${crypto.randomUUID()}.${ext}`;
        await uploadToStorageFromBrowser('packshots', path, file, file.type);

        const res = await apiJson<{ packshot: PackshotItem }>('/api/studio/packshots', 'POST', {
          path,
          originalFilename: file.name,
          width: dims.width,
          height: dims.height,
        });
        setPackshots((prev) => [res.packshot, ...prev]);
        setSelectedPackshots((prev) =>
          prev.length >= MAX_PACKSHOTS_PER_GENERATION
            ? prev
            : [...prev, { id: res.packshot.id, role: prev.length === 0 ? 'main' : 'addition', note: '' }]
        );
        toast('success', 'Packshot wgrany.');
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Upload nie powiódł się.');
      } finally {
        setUploading(false);
      }
    },
    [toast]
  );

  /** Zaznaczenie/odznaczenie kafelka; pierwszy wybrany automatycznie = główny. */
  function togglePackshot(id: string) {
    setSelectedPackshots((prev) => {
      if (prev.some((p) => p.id === id)) {
        const next = prev.filter((p) => p.id !== id);
        // Zawsze przynajmniej jeden główny, jeśli coś zostało.
        return next.length > 0 && !next.some((p) => p.role === 'main')
          ? next.map((p, i) => (i === 0 ? { ...p, role: 'main' as const } : p))
          : next;
      }
      if (prev.length >= MAX_PACKSHOTS_PER_GENERATION) {
        toast('error', `Maksymalnie ${MAX_PACKSHOTS_PER_GENERATION} packshotów w jednej wizualizacji.`);
        return prev;
      }
      return [...prev, { id, role: prev.length === 0 ? 'main' : 'addition', note: '' }];
    });
  }

  function setPackshotNote(id: string, note: string) {
    setSelectedPackshots((prev) => prev.map((p) => (p.id === id ? { ...p, note } : p)));
  }

  function togglePackshotRole(id: string) {
    setSelectedPackshots((prev) => {
      const next = prev.map((p) =>
        p.id === id ? { ...p, role: (p.role === 'main' ? 'addition' : 'main') as PackshotRole } : p
      );
      // Ostatniego głównego nie da się zdegradować — musi zostać co najmniej jeden.
      return next.some((p) => p.role === 'main') ? next : prev;
    });
  }

  async function handleSubmit() {
    if (selectedPackshots.length === 0) return toast('error', 'Wybierz albo wgraj packshot produktu.');
    if (!roomId) return toast('error', 'Wybierz pokój.');
    setSubmitting(true);
    try {
      const res = await apiJson<{ generation: GenerationRow }>('/api/studio/generations', 'POST', {
        packshots: selectedPackshots,
        roomId,
        styleText: styleText || undefined,
        inspirationSetId: setId,
        inspirationStrength: setId ? strength : undefined,
        manualNotes: notes || undefined,
        aspectRatio,
        model,
        async: true,
      });
      router.push(`/studio/generations/${res.generation.id}`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się rozpocząć generacji.');
      setSubmitting(false);
    }
  }

  const suggestedSets = roomId ? sets.filter((s) => s.room_id === roomId) : [];
  const otherSets = roomId ? sets.filter((s) => s.room_id !== roomId) : sets;
  const selectedModel = STUDIO_MODELS.find((m) => m.id === model);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <PageTitle
        title="Nowa wizualizacja"
        subtitle="Packshot produktu + pokój + styl — resztą zajmie się model."
      />

      <div className="space-y-6">
        {/* Krok 1: Packshot */}
        <Card className="p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-studio-muted">
            1. Packshoty produktów (do {MAX_PACKSHOTS_PER_GENERATION})
          </h2>
          <p className="text-xs text-studio-muted">
            Pierwszy wybrany zostaje <strong>głównym</strong> produktem, kolejne — dodatkami.
            Kliknij etykietę roli na miniaturze, żeby ją zmienić (może być kilka głównych, np. kolekcja mebli).
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) void handleUpload(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
              dragOver
                ? 'border-studio-accent bg-studio-accent-soft'
                : 'border-studio-border hover:border-studio-accent/50'
            )}
          >
            {uploading ? (
              <Spinner className="h-8 w-8" />
            ) : (
              <ImagePlus className="h-8 w-8 text-studio-muted" />
            )}
            <p className="text-sm font-medium text-studio-ink">
              Przeciągnij packshot albo kliknij, żeby wybrać plik
            </p>
            <p className="text-xs text-studio-muted">PNG, JPG lub WEBP, do 20 MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
                e.target.value = '';
              }}
            />
          </div>

          {packshots.length > 0 && (
            <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-6">
              {packshots.slice(0, 18).map((p) => {
                const selection = selectedPackshots.find((s) => s.id === p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => togglePackshot(p.id)}
                    role="button"
                    className={cn(
                      'group relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 bg-white transition-all',
                      selection
                        ? 'border-studio-accent ring-2 ring-studio-accent/30'
                        : 'border-studio-border hover:border-studio-accent/50'
                    )}
                    title={p.original_filename ?? undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.image_url}
                      alt={p.original_filename ?? 'packshot'}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                    {selection && (
                      <>
                        <span className="absolute right-1 top-1 rounded-full bg-studio-accent p-1 text-white">
                          <Check className="h-3 w-3" />
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePackshotRole(p.id);
                          }}
                          title="Kliknij, żeby zmienić rolę"
                          className={cn(
                            'absolute inset-x-1 bottom-1 rounded-md px-1 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide transition-colors',
                            selection.role === 'main'
                              ? 'bg-studio-accent text-white hover:bg-studio-accent-dark'
                              : 'bg-studio-ink/70 text-white hover:bg-studio-ink'
                          )}
                        >
                          {selection.role === 'main' ? 'Główny' : 'Dodatek'}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {selectedPackshots.length > 0 && (
            <div className="mt-4 space-y-2">
              {selectedPackshots.map((s) => {
                const pk = packshots.find((p) => p.id === s.id);
                return (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 rounded-xl bg-studio-bg p-2.5"
                  >
                    {pk ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={pk.image_url}
                        alt={pk.original_filename ?? 'packshot'}
                        className="h-12 w-12 shrink-0 rounded-lg border border-studio-border bg-white object-contain"
                      />
                    ) : (
                      <span className="h-12 w-12 shrink-0 rounded-lg border border-studio-border bg-white" />
                    )}
                    <button
                      onClick={() => togglePackshotRole(s.id)}
                      title="Kliknij, żeby zmienić rolę"
                      className={cn(
                        'shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                        s.role === 'main'
                          ? 'bg-studio-accent text-white hover:bg-studio-accent-dark'
                          : 'bg-studio-ink/70 text-white hover:bg-studio-ink'
                      )}
                    >
                      {s.role === 'main' ? 'Główny' : 'Dodatek'}
                    </button>
                    <input
                      value={s.note}
                      onChange={(e) => setPackshotNote(s.id, e.target.value)}
                      maxLength={500}
                      placeholder="Gdzie ustawić? Co na nim położyć? (np. przy oknie, na nim lniany pled)"
                      className="w-full min-w-0 flex-1 rounded-lg border border-studio-border bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-studio-muted/60 focus:border-studio-accent"
                    />
                  </div>
                );
              })}
              {selectedPackshots.length > 1 && (
                <p className="text-xs text-studio-muted">
                  Wszystkie produkty pozostaną wiernie odwzorowane w jednej scenie.
                </p>
              )}
            </div>
          )}
        </Card>

        {/* Krok 2: Pokój */}
        <Card className="p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-studio-muted">
            2. Pokój
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {rooms.map((room) => (
              <button
                key={room.id}
                onClick={() => setRoomId(room.id === roomId ? null : room.id)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border-2 px-3 py-4 text-center transition-all',
                  roomId === room.id
                    ? 'border-studio-accent bg-studio-accent-soft'
                    : 'border-studio-border hover:border-studio-accent/50'
                )}
              >
                <RoomIcon
                  icon={room.icon}
                  className={cn(
                    'h-6 w-6',
                    roomId === room.id ? 'text-studio-accent-dark' : 'text-studio-muted'
                  )}
                />
                <span className="text-sm font-medium leading-tight">{room.name}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Krok 3: Styl */}
        <Card className="p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-studio-muted">
            3. Styl aranżacji
          </h2>
          <label className="mb-1.5 block text-xs font-medium text-studio-muted">
            Opis własny (opcjonalnie)
          </label>
          <textarea
            value={styleText}
            onChange={(e) => setStyleText(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="np. japandi, jasne drewno dębowe, len, poranne światło"
            className="w-full rounded-xl border border-studio-border bg-white px-4 py-3 text-sm outline-none transition-colors placeholder:text-studio-muted/60 focus:border-studio-accent"
          />

          <label className="mb-1.5 mt-4 block text-xs font-medium text-studio-muted">
            Zestaw inspiracji (opcjonalnie)
          </label>
          {sets.length === 0 ? (
            <p className="text-sm text-studio-muted">
              Brak zestawów — możesz je dodać w sekcji Inspiracje.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {[...suggestedSets, ...otherSets].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSetId(s.id === setId ? null : s.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-full border-2 py-1 pl-1 pr-3 text-sm transition-all',
                    setId === s.id
                      ? 'border-studio-accent bg-studio-accent-soft font-medium'
                      : 'border-studio-border hover:border-studio-accent/50'
                  )}
                >
                  {s.cover_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={s.cover_url}
                      alt=""
                      className="h-6 w-6 rounded-full object-cover"
                    />
                  ) : (
                    <span className="h-6 w-6 rounded-full bg-studio-bg" />
                  )}
                  {s.name}
                  <span className="text-xs text-studio-muted">({s.image_count})</span>
                  {suggestedSets.includes(s) && <Badge tone="accent">pasuje do pokoju</Badge>}
                </button>
              ))}
            </div>
          )}

          {setId && (
            <div className="mt-5 rounded-xl bg-studio-bg p-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-studio-muted">Siła inspiracji</label>
                <span className="text-sm font-semibold text-studio-accent-dark">
                  {strength} — {labelForStrength(strength)}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={strength}
                onChange={(e) => setStrength(Number(e.target.value))}
                className="mt-2 w-full accent-studio-accent"
              />
              <div className="mt-1 flex justify-between text-[10px] text-studio-muted">
                <span>1 · subtelnie</span>
                <span>5 · wiernie</span>
              </div>
            </div>
          )}
        </Card>

        {/* Krok 4: Uwagi */}
        <Card className="p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-studio-muted">
            4. Uwagi ogólne (opcjonalnie)
          </h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="np. miękkie poranne światło; nie używaj roślin w wizce"
            className="w-full rounded-xl border border-studio-border bg-white px-4 py-3 text-sm outline-none transition-colors placeholder:text-studio-muted/60 focus:border-studio-accent"
          />
          <p className="mt-1.5 text-xs text-studio-muted">
            Uwagi dotyczące całej sceny (światło, klimat, czego nie używać). Umiejscowienie
            konkretnego produktu wpisz w polu przy jego packshocie w kroku 1.
          </p>
        </Card>

        {/* Krok 5: Format kadru */}
        <Card className="p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-studio-muted">
            5. Format kadru
          </h2>
          <div className="flex flex-wrap gap-3">
            {ASPECT_RATIOS.map((ar) => {
              const [w, h] = ar.id.split(':').map(Number);
              return (
                <button
                  key={ar.id}
                  onClick={() => setAspectRatio(ar.id)}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border-2 px-4 py-3 transition-all',
                    aspectRatio === ar.id
                      ? 'border-studio-accent bg-studio-accent-soft'
                      : 'border-studio-border hover:border-studio-accent/50'
                  )}
                  title={`Proporcje ${ar.id}`}
                >
                  <span
                    className={cn(
                      'rounded-sm border-2',
                      aspectRatio === ar.id ? 'border-studio-accent-dark' : 'border-studio-muted'
                    )}
                    style={{ width: w >= h ? 36 : (36 * w) / h, height: w >= h ? (36 * h) / w : 36 }}
                  />
                  <span className="text-xs font-medium leading-tight">
                    {ar.labelPl}
                    <span className="block text-center text-[10px] text-studio-muted">{ar.id}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-studio-muted">
            Proporcje są twardo wymuszane na poziomie API modelu — wynik zawsze wyjdzie w wybranym
            formacie.
          </p>
        </Card>

        {/* Krok 6: Model */}
        <Card className="p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-studio-muted">
            6. Model generacji
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {STUDIO_MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={cn(
                  'flex flex-col gap-1.5 rounded-xl border-2 p-4 text-left transition-all',
                  model === m.id
                    ? 'border-studio-accent bg-studio-accent-soft'
                    : 'border-studio-border hover:border-studio-accent/50'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{m.label}</span>
                  {m.id === DEFAULT_GENERATION_MODEL && <Badge tone="accent">domyślny</Badge>}
                </div>
                <span className="text-xs text-studio-muted">{m.vendor}</span>
                <span className="text-xs leading-snug text-studio-ink/80">{m.description}</span>
                <span className="mt-1 text-xs font-medium text-studio-accent-dark">
                  {m.whenToUse}
                </span>
              </button>
            ))}
          </div>
        </Card>

        <div className="flex items-center justify-end gap-4 pb-8">
          {selectedModel && (
            <p className="text-sm text-studio-muted">
              Szacowany czas: ~{selectedModel.estimatedSeconds} s
            </p>
          )}
          <Button onClick={handleSubmit} disabled={submitting} className="px-8 py-3 text-base">
            {submitting ? <Spinner className="h-5 w-5 text-white" /> : <Sparkles className="h-5 w-5" />}
            Generuj wizualizację
          </Button>
        </div>
      </div>
    </div>
  );
}

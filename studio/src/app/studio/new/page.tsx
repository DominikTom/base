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
  CAMERA_ANGLES,
  CAMERA_SHOTS,
  DEFAULT_ASPECT_RATIO,
  LIGHTING_PRESETS,
  MAX_BATCH_MODELS,
  MAX_BATCH_ROOMS,
  MAX_BATCH_TOTAL,
  MAX_PACKSHOTS_PER_GENERATION,
  MAX_VARIANTS,
  type AspectRatio,
  type CameraAngle,
  type CameraShot,
  type CreatorTemplatePayload,
  type CreatorTemplateRow,
  type GenerationRow,
  type InspirationSetRow,
  type LightingPreset,
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
  /** Pokoje serii (1–4) — każdy pokój to osobna generacja. */
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [styleText, setStyleText] = useState('');
  const [setId, setSetId] = useState<string | null>(null);
  const [strength, setStrength] = useState(3);
  const [notes, setNotes] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(DEFAULT_ASPECT_RATIO);
  const [cameraShot, setCameraShot] = useState<CameraShot>('auto');
  const [cameraAngle, setCameraAngle] = useState<CameraAngle>('auto');
  const [lighting, setLighting] = useState<LightingPreset>('auto');
  /** Modele serii (1–3) — porównanie tej samej sceny na różnych modelach. */
  const [models, setModels] = useState<StudioModelId[]>([DEFAULT_GENERATION_MODEL]);
  /** Warianty na kombinację pokój × model. */
  const [variants, setVariants] = useState(1);
  const [imageSize, setImageSize] = useState<'2K' | '4K'>('2K');
  const [templates, setTemplates] = useState<CreatorTemplateRow[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [showTemplateSave, setShowTemplateSave] = useState(false);

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
        apiGet<{ templates: CreatorTemplateRow[] }>('/api/studio/templates')
          .then((t) => setTemplates(t.templates))
          .catch(() => {});

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
          if (g.room_id) setRoomIds([g.room_id]);
          setStyleText(g.style_text ?? '');
          setSetId(g.inspiration_set_id);
          if (g.inspiration_strength) setStrength(g.inspiration_strength);
          setNotes(g.manual_notes ?? '');
          if (g.aspect_ratio && ASPECT_RATIOS.some((a) => a.id === g.aspect_ratio)) {
            setAspectRatio(g.aspect_ratio as AspectRatio);
          }
          if (g.camera_shot) setCameraShot(g.camera_shot as CameraShot);
          if (g.camera_angle) setCameraAngle(g.camera_angle as CameraAngle);
          if (g.lighting) setLighting(g.lighting as LightingPreset);
          if (g.image_size === '4K') setImageSize('4K');
          if (STUDIO_MODELS.some((m) => m.id === g.model)) setModels([g.model as StudioModelId]);
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

  const totalGenerations = roomIds.length * models.length * variants;

  async function handleSubmit() {
    if (selectedPackshots.length === 0) return toast('error', 'Wybierz albo wgraj packshot produktu.');
    if (roomIds.length === 0) return toast('error', 'Wybierz przynajmniej jeden pokój.');
    if (models.length === 0) return toast('error', 'Wybierz przynajmniej jeden model.');
    if (totalGenerations > MAX_BATCH_TOTAL) {
      return toast(
        'error',
        `Seria ma ${totalGenerations} generacji — maksimum to ${MAX_BATCH_TOTAL}. Zmniejsz liczbę pokoi, modeli lub wariantów.`
      );
    }
    setSubmitting(true);
    try {
      const res = await apiJson<{
        generation: GenerationRow;
        batchId: string | null;
        generationIds: string[];
      }>('/api/studio/generations', 'POST', {
        packshots: selectedPackshots,
        roomIds,
        styleText: styleText || undefined,
        inspirationSetId: setId,
        inspirationStrength: setId ? strength : undefined,
        manualNotes: notes || undefined,
        aspectRatio,
        cameraShot,
        cameraAngle,
        lighting,
        imageSize: models.includes('nano-banana-pro') && imageSize === '4K' ? '4K' : undefined,
        models,
        variants,
        async: true,
      });
      router.push(
        res.batchId ? `/studio/batch/${res.batchId}` : `/studio/generations/${res.generation.id}`
      );
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się rozpocząć generacji.');
      setSubmitting(false);
    }
  }

  function applyTemplate(t: CreatorTemplateRow) {
    const p: CreatorTemplatePayload = t.payload ?? {};
    if (p.roomIds) setRoomIds(p.roomIds.filter((id) => rooms.some((r) => r.id === id)));
    if (p.styleText !== undefined) setStyleText(p.styleText);
    if (p.inspirationSetId !== undefined) {
      setSetId(p.inspirationSetId && sets.some((s) => s.id === p.inspirationSetId) ? p.inspirationSetId : null);
    }
    if (p.inspirationStrength) setStrength(p.inspirationStrength);
    if (p.manualNotes !== undefined) setNotes(p.manualNotes);
    if (p.aspectRatio && ASPECT_RATIOS.some((a) => a.id === p.aspectRatio)) {
      setAspectRatio(p.aspectRatio as AspectRatio);
    }
    if (p.cameraShot) setCameraShot(p.cameraShot as CameraShot);
    if (p.cameraAngle) setCameraAngle(p.cameraAngle as CameraAngle);
    if (p.lighting) setLighting(p.lighting as LightingPreset);
    if (p.models) {
      const valid = p.models.filter((m): m is StudioModelId => STUDIO_MODELS.some((sm) => sm.id === m));
      if (valid.length > 0) setModels(valid);
    }
    if (p.variants) setVariants(Math.min(MAX_VARIANTS, p.variants));
    if (p.imageSize === '4K' || p.imageSize === '2K') setImageSize(p.imageSize);
    toast('info', `Zastosowano szablon „${t.name}".`);
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) return toast('error', 'Podaj nazwę szablonu.');
    try {
      const res = await apiJson<{ template: CreatorTemplateRow }>('/api/studio/templates', 'POST', {
        name: templateName.trim(),
        payload: {
          roomIds,
          styleText: styleText || undefined,
          inspirationSetId: setId,
          inspirationStrength: setId ? strength : undefined,
          manualNotes: notes || undefined,
          aspectRatio,
          cameraShot,
          cameraAngle,
          lighting,
          models,
          variants,
          imageSize,
        } satisfies CreatorTemplatePayload,
      });
      setTemplates((prev) => [res.template, ...prev]);
      setTemplateName('');
      setShowTemplateSave(false);
      toast('success', 'Szablon zapisany.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się zapisać szablonu.');
    }
  }

  const suggestedSets = roomIds.length > 0 ? sets.filter((s) => s.room_id && roomIds.includes(s.room_id)) : [];
  const otherSets = sets.filter((s) => !suggestedSets.includes(s));
  const estimatedSeconds = Math.max(
    0,
    ...models.map((m) => STUDIO_MODELS.find((sm) => sm.id === m)?.estimatedSeconds ?? 40)
  );

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
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {templates.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  const t = templates.find((x) => x.id === e.target.value);
                  if (t) applyTemplate(t);
                }}
                className="rounded-xl border border-studio-border bg-white px-3 py-2 text-sm outline-none focus:border-studio-accent"
              >
                <option value="">Szablon ustawień…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            {showTemplateSave ? (
              <div className="flex items-center gap-1.5">
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTemplate()}
                  placeholder="Nazwa szablonu…"
                  maxLength={120}
                  autoFocus
                  className="w-44 rounded-xl border border-studio-border bg-white px-3 py-2 text-sm outline-none focus:border-studio-accent"
                />
                <Button variant="secondary" onClick={handleSaveTemplate} className="px-3 py-2">
                  Zapisz
                </Button>
                <Button variant="ghost" onClick={() => setShowTemplateSave(false)} className="px-2 py-2">
                  ✕
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setShowTemplateSave(true)} className="px-3 py-2">
                Zapisz jako szablon
              </Button>
            )}
          </div>
        }
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

        {/* Krok 2: Pokoje */}
        <Card className="p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-studio-muted">
            2. Pokoje (do {MAX_BATCH_ROOMS})
          </h2>
          <p className="mb-3 text-xs text-studio-muted">
            Możesz wybrać kilka — każdy pokój to osobna wizualizacja w serii.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {rooms.map((room) => {
              const active = roomIds.includes(room.id);
              return (
                <button
                  key={room.id}
                  onClick={() =>
                    setRoomIds((prev) => {
                      if (prev.includes(room.id)) return prev.filter((id) => id !== room.id);
                      if (prev.length >= MAX_BATCH_ROOMS) {
                        toast('error', `Maksymalnie ${MAX_BATCH_ROOMS} pokoje w jednej serii.`);
                        return prev;
                      }
                      return [...prev, room.id];
                    })
                  }
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border-2 px-3 py-4 text-center transition-all',
                    active
                      ? 'border-studio-accent bg-studio-accent-soft'
                      : 'border-studio-border hover:border-studio-accent/50'
                  )}
                >
                  <RoomIcon
                    icon={room.icon}
                    className={cn('h-6 w-6', active ? 'text-studio-accent-dark' : 'text-studio-muted')}
                  />
                  <span className="text-sm font-medium leading-tight">{room.name}</span>
                </button>
              );
            })}
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

        {/* Krok 6: Ujęcie i światło */}
        <Card className="p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-studio-muted">
            6. Ujęcie i światło
          </h2>
          <div className="space-y-4">
            <ChipRow
              label="Ujęcie"
              options={CAMERA_SHOTS}
              value={cameraShot}
              onChange={(v) => setCameraShot(v as CameraShot)}
            />
            <ChipRow
              label="Kąt kamery"
              options={CAMERA_ANGLES}
              value={cameraAngle}
              onChange={(v) => setCameraAngle(v as CameraAngle)}
            />
            <ChipRow
              label="Oświetlenie sceny"
              options={LIGHTING_PRESETS}
              value={lighting}
              onChange={(v) => setLighting(v as LightingPreset)}
            />
          </div>
          <p className="mt-3 text-xs text-studio-muted">
            Niezależnie od wyboru, światło na produkcie jest zawsze dopasowywane do aranżacji
            (kierunek, temperatura barwowa, cienie kontaktowe) — bryła, tkanina i kolor produktu
            pozostają nietknięte. „Auto" = model komponuje sam.
          </p>
        </Card>

        {/* Krok 7: Modele i seria */}
        <Card className="p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-studio-muted">
            7. Modele i seria
          </h2>
          <p className="mb-3 text-xs text-studio-muted">
            Możesz zaznaczyć kilka modeli ({MAX_BATCH_MODELS} maks.) — ta sama scena wygeneruje się
            na każdym z nich do porównania.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {STUDIO_MODELS.map((m) => {
              const active = models.includes(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() =>
                    setModels((prev) => {
                      if (prev.includes(m.id)) {
                        return prev.length > 1 ? prev.filter((id) => id !== m.id) : prev;
                      }
                      if (prev.length >= MAX_BATCH_MODELS) return prev;
                      return [...prev, m.id];
                    })
                  }
                  className={cn(
                    'flex flex-col gap-1.5 rounded-xl border-2 p-4 text-left transition-all',
                    active
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
              );
            })}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <ChipRow
              label="Warianty na kombinację (pokój × model)"
              options={Array.from({ length: MAX_VARIANTS }, (_, i) => ({
                id: String(i + 1),
                labelPl: String(i + 1),
              }))}
              value={String(variants)}
              onChange={(v) => setVariants(Number(v))}
            />
            {models.includes('nano-banana-pro') && (
              <ChipRow
                label="Rozdzielczość (Nano Banana Pro)"
                options={[
                  { id: '2K', labelPl: 'Standard (2K)' },
                  { id: '4K', labelPl: 'Maksymalna (4K, wolniejsza)' },
                ]}
                value={imageSize}
                onChange={(v) => setImageSize(v as '2K' | '4K')}
              />
            )}
          </div>
        </Card>

        <div className="flex items-center justify-end gap-4 pb-8">
          <p className={cn('text-sm', totalGenerations > MAX_BATCH_TOTAL ? 'font-medium text-red-600' : 'text-studio-muted')}>
            Seria: {roomIds.length || '–'} {roomIds.length === 1 ? 'pokój' : 'pokoje'} ×{' '}
            {models.length} {models.length === 1 ? 'model' : 'modele'} × {variants}{' '}
            {variants === 1 ? 'wariant' : 'warianty'} = <strong>{totalGenerations || '–'}</strong>{' '}
            generacji (maks. {MAX_BATCH_TOTAL}) · ~{estimatedSeconds} s/szt.
          </p>
          <Button onClick={handleSubmit} disabled={submitting} className="px-8 py-3 text-base">
            {submitting ? <Spinner className="h-5 w-5 text-white" /> : <Sparkles className="h-5 w-5" />}
            {totalGenerations > 1 ? `Generuj serię (${totalGenerations})` : 'Generuj wizualizację'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; labelPl: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-studio-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              'rounded-full border-2 px-3 py-1.5 text-sm transition-all',
              value === o.id
                ? 'border-studio-accent bg-studio-accent-soft font-medium'
                : 'border-studio-border hover:border-studio-accent/50'
            )}
          >
            {o.labelPl}
          </button>
        ))}
      </div>
    </div>
  );
}

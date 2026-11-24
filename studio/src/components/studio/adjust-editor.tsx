'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Eye, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useToast } from '@/components/studio/toast';
import { Button, Card, Spinner } from '@/components/studio/ui';
import { apiGet, apiJson } from '@/lib/studio/client';
import {
  BUILTIN_FILTERS,
  DEFAULT_ADJUSTMENTS,
  cssFilterFor,
  describeAdjustments,
  isDefaultAdjustments,
  renderAdjustedCanvas,
  sanitizeAdjustments,
  temperatureTint,
  type AdjustmentSettings,
} from '@/lib/studio/adjustments';
import { getBrowserUserId, uploadToStorageFromBrowser } from '@/lib/studio/supabase-browser';
import { cn } from '@/lib/utils';

interface PresetRow {
  id: string;
  name: string;
  payload: Record<string, unknown>;
}

const SLIDERS: { key: keyof AdjustmentSettings & string; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: 'Jasność', min: -50, max: 50 },
  { key: 'contrast', label: 'Kontrast', min: -50, max: 50 },
  { key: 'saturation', label: 'Nasycenie', min: -50, max: 50 },
  { key: 'temperature', label: 'Temperatura (zimno ↔ ciepło)', min: -50, max: 50 },
  { key: 'vignette', label: 'Winieta', min: 0, max: 100 },
];

/**
 * Korekty obrazu: podstawowe suwaki + filtry + presety użytkownika.
 * Wszystko liczy się w przeglądarce (CSS na podglądzie, canvas przy zapisie)
 * — bez modeli AI; zapis tworzy nową, gotową wersję w drzewie.
 */
export function AdjustEditor({
  imageUrl,
  sourceType,
  sourceId,
}: {
  imageUrl: string;
  sourceType: 'generation' | 'packshot';
  sourceId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [settings, setSettings] = useState<AdjustmentSettings>({ ...DEFAULT_ADJUSTMENTS });
  const [showOriginal, setShowOriginal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [presetName, setPresetName] = useState('');
  const [showPresetSave, setShowPresetSave] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imageReady, setImageReady] = useState(false);

  // Obraz w pełnej rozdzielczości do finalnego renderu (same-origin proxy — bez CORS).
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImageReady(true);
    };
    img.onerror = () => toast('error', 'Nie udało się załadować obrazu do korekt.');
    img.src = imageUrl;
  }, [imageUrl, toast]);

  useEffect(() => {
    apiGet<{ presets: PresetRow[] }>('/api/studio/presets')
      .then((d) => setPresets(d.presets))
      .catch(() => {});
  }, []);

  function set(key: keyof AdjustmentSettings, value: number | boolean) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  const effective = showOriginal ? DEFAULT_ADJUSTMENTS : settings;
  const tint = temperatureTint(effective);
  const isDirty = !isDefaultAdjustments(settings);

  /** Który wbudowany filtr odpowiada bieżącym ustawieniom (zaznaczenie chipa). */
  const activeFilterId = useMemo(() => {
    const match = BUILTIN_FILTERS.find((f) => JSON.stringify(f.settings) === JSON.stringify(settings));
    return match?.id ?? null;
  }, [settings]);

  const handleSave = useCallback(async () => {
    const img = imgRef.current;
    if (!img) return;
    if (!isDirty) {
      toast('error', 'Brak zmian do zapisania — przesuń któryś suwak albo wybierz filtr.');
      return;
    }
    setSaving(true);
    try {
      const canvas = renderAdjustedCanvas(img, settings);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Render obrazu nie powiódł się.');

      // Upload z przeglądarki prosto do Storage (omija limit 4,5 MB body Vercela).
      const userId = await getBrowserUserId();
      const path = `${userId}/adjust-${crypto.randomUUID()}.png`;
      await uploadToStorageFromBrowser('generations', path, blob, 'image/png');

      const res = await apiJson<{ generation: { id: string } }>('/api/studio/adjustments', 'POST', {
        sourceType,
        sourceId,
        path,
        width: canvas.width,
        height: canvas.height,
        description: describeAdjustments(settings),
      });
      toast('success', 'Korekty zapisane jako nowa wersja.');
      router.push(`/studio/generations/${res.generation.id}`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się zapisać korekt.');
      setSaving(false);
    }
  }, [settings, isDirty, sourceType, sourceId, router, toast]);

  async function handleSavePreset() {
    const name = presetName.trim();
    if (!name) return toast('error', 'Podaj nazwę presetu.');
    try {
      const res = await apiJson<{ preset: PresetRow }>('/api/studio/presets', 'POST', {
        name,
        payload: settings,
      });
      setPresets((prev) => [res.preset, ...prev]);
      setPresetName('');
      setShowPresetSave(false);
      toast('success', `Preset „${name}" zapisany.`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się zapisać presetu.');
    }
  }

  async function handleDeletePreset(p: PresetRow) {
    try {
      await apiJson(`/api/studio/presets/${p.id}`, 'DELETE');
      setPresets((prev) => prev.filter((x) => x.id !== p.id));
      toast('success', `Preset „${p.name}" usunięty.`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się usunąć presetu.');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Podgląd na żywo */}
      <Card className="overflow-hidden p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <button
            onPointerDown={() => setShowOriginal(true)}
            onPointerUp={() => setShowOriginal(false)}
            onPointerLeave={() => setShowOriginal(false)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-studio-border bg-studio-surface px-3 py-1.5 text-xs font-medium text-studio-muted transition-colors hover:text-studio-ink"
            title="Przytrzymaj, żeby porównać z oryginałem"
          >
            <Eye className="h-4 w-4" /> Przytrzymaj: oryginał
          </button>
          {isDirty && (
            <button
              onClick={() => setSettings({ ...DEFAULT_ADJUSTMENTS })}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs text-studio-muted transition-colors hover:bg-studio-accent-soft hover:text-studio-ink"
            >
              <RotateCcw className="h-4 w-4" /> Resetuj
            </button>
          )}
        </div>
        {!imageReady ? (
          <div className="flex h-96 items-center justify-center">
            <Spinner className="h-8 w-8" />
          </div>
        ) : (
          <div className="relative mx-auto w-fit max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Podgląd korekt"
              className="block max-h-[66dvh] w-auto max-w-full rounded-lg"
              style={{ filter: cssFilterFor(effective) }}
              draggable={false}
            />
            {tint && (
              <div
                className="pointer-events-none absolute inset-0 rounded-lg"
                style={{
                  backgroundColor: tint.color,
                  opacity: tint.alpha,
                  mixBlendMode: 'soft-light',
                }}
              />
            )}
            {effective.vignette > 0 && (
              <div
                className="pointer-events-none absolute inset-0 rounded-lg"
                style={{
                  background: `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,${
                    0.55 * (effective.vignette / 100)
                  }) 100%)`,
                }}
              />
            )}
          </div>
        )}
      </Card>

      {/* Panel korekt */}
      <div className="space-y-4">
        <Card className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-studio-muted">
            Suwaki
          </p>
          <div className="space-y-3.5">
            {SLIDERS.map((sl) => (
              <div key={sl.key}>
                <label className="mb-1 flex items-center justify-between text-xs font-medium text-studio-muted">
                  {sl.label}
                  <span className={cn('tabular-nums', settings[sl.key] !== 0 && 'text-studio-accent-dark')}>
                    {settings[sl.key] as number}
                  </span>
                </label>
                <input
                  type="range"
                  min={sl.min}
                  max={sl.max}
                  step={1}
                  value={settings[sl.key] as number}
                  onChange={(e) => set(sl.key, Number(e.target.value))}
                  onDoubleClick={() => set(sl.key, 0)}
                  aria-label={sl.label}
                  className="w-full accent-studio-accent"
                />
              </div>
            ))}
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.grayscale}
                onChange={(e) => set('grayscale', e.target.checked)}
                className="h-4 w-4 accent-studio-accent"
              />
              Czarno-biały
            </label>
          </div>
          <p className="mt-2 text-[11px] text-studio-muted">
            Dwuklik na suwaku zeruje jego wartość.
          </p>
        </Card>

        <Card className="p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-studio-muted">
            Filtry
          </p>
          <div className="flex flex-wrap gap-1.5">
            {BUILTIN_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setSettings({ ...f.settings })}
                className={cn(
                  'rounded-full border-2 px-3 py-1.5 text-xs transition-all',
                  activeFilterId === f.id
                    ? 'border-studio-accent bg-studio-accent-soft font-medium'
                    : 'border-studio-border hover:border-studio-accent/50'
                )}
              >
                {f.name}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-studio-muted">
              Twoje presety
            </p>
            {!showPresetSave && (
              <button
                onClick={() => setShowPresetSave(true)}
                disabled={!isDirty}
                className="text-xs text-studio-accent-dark hover:underline disabled:opacity-40"
                title={isDirty ? 'Zapisz bieżące suwaki jako preset' : 'Najpierw ustaw suwaki'}
              >
                + Zapisz bieżące
              </button>
            )}
          </div>
          {showPresetSave && (
            <div className="mb-2 flex items-center gap-1.5">
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSavePreset();
                  if (e.key === 'Escape') setShowPresetSave(false);
                }}
                placeholder="Nazwa presetu…"
                maxLength={120}
                autoFocus
                className="w-full min-w-0 flex-1 rounded-lg border border-studio-border bg-studio-surface px-3 py-1.5 text-sm outline-none focus:border-studio-accent"
              />
              <button
                onClick={handleSavePreset}
                className="shrink-0 rounded-md p-1.5 text-emerald-400 light:text-emerald-600 hover:bg-studio-bg"
                aria-label="Zapisz preset"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={() => setShowPresetSave(false)}
                className="shrink-0 rounded-md p-1.5 text-studio-muted hover:bg-studio-bg"
                aria-label="Anuluj"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {presets.length === 0 ? (
            <p className="text-xs text-studio-muted">
              Brak presetów — ustaw suwaki i zapisz je pod własną nazwą, żeby wracać do nich jednym
              kliknięciem.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-full border-2 border-studio-border text-xs transition-all hover:border-studio-accent/50"
                >
                  <button
                    onClick={() => setSettings(sanitizeAdjustments(p.payload))}
                    className="py-1.5 pl-3 font-medium"
                    title="Zastosuj preset"
                  >
                    {p.name}
                  </button>
                  <button
                    onClick={() => handleDeletePreset(p)}
                    className="rounded-full p-1 pr-2 text-studio-muted transition-colors hover:text-red-400 light:hover:text-red-600"
                    aria-label={`Usuń preset ${p.name}`}
                    title="Usuń preset"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Card>

        <Button onClick={handleSave} disabled={saving || !imageReady} className="w-full py-3">
          {saving ? <Spinner className="h-5 w-5 text-white" /> : <Save className="h-5 w-5" />}
          Zapisz jako nową wersję
        </Button>
        <p className="text-center text-xs text-studio-muted">
          Korekty liczą się w przeglądarce (bez AI) — oryginał zostaje bez zmian, wynik trafia do
          drzewa wersji.
        </p>
      </div>
    </div>
  );
}

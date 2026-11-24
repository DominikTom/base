'use client';

import { useMemo, useRef, useState } from 'react';
import { ImagePlus, Wand2, X } from 'lucide-react';
import { ModelGuide } from '@/components/studio/model-guide';
import { useToast } from '@/components/studio/toast';
import { Badge, Button, Card, Spinner } from '@/components/studio/ui';
import { STUDIO_MODELS, type StudioModelId } from '@/lib/studio/models';
import { validateImageFile } from '@/lib/studio/upload-limits';

export interface DescribeEditorSubmit {
  instruction: string;
  model: StudioModelId;
  references: File[];
}

const MAX_EDIT_REFERENCES = 4;

/** Domyślny model edycji opisowej: Gemini — najlepszy w lokalizowaniu elementu z opisu. */
const DEFAULT_DESCRIBE_MODEL: StudioModelId = 'nano-banana-pro';

/**
 * Edycja OPISOWA — bez pędzla i maski: piszesz, co poprawić, model sam
 * znajduje element na obrazie. Najskuteczniejsze na modelach Google
 * (widzą cały obraz i świetnie wykonują instrukcje tekstowe).
 */
export function DescribeEditor({
  imageUrl,
  onSubmit,
  busy,
}: {
  imageUrl: string;
  onSubmit: (payload: DescribeEditorSubmit) => void | Promise<void>;
  busy: boolean;
}) {
  const { toast } = useToast();
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState<StudioModelId>(DEFAULT_DESCRIBE_MODEL);
  const [references, setReferences] = useState<{ file: File; url: string }[]>([]);
  const refInputRef = useRef<HTMLInputElement>(null);

  /** Grupy: do opisowej polecamy modele Google (pełny obraz + instrukcja). */
  const modelGroups = useMemo(() => {
    const current = STUDIO_MODELS.filter((m) => !m.legacy);
    const recommended = current.filter((m) => m.provider === 'gemini');
    return {
      recommended,
      other: current.filter((m) => !recommended.includes(m)),
      legacy: STUDIO_MODELS.filter((m) => m.legacy),
    };
  }, []);

  function addReferences(files: FileList | null) {
    if (!files) return;
    const incoming = [...files];
    setReferences((prev) => {
      const next = [...prev];
      for (const f of incoming) {
        if (next.length >= MAX_EDIT_REFERENCES) break;
        if (validateImageFile(f)) continue;
        next.push({ file: f, url: URL.createObjectURL(f) });
      }
      return next;
    });
  }

  function removeReference(index: number) {
    setReferences((prev) => {
      URL.revokeObjectURL(prev[index]?.url);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit() {
    if (!instruction.trim()) {
      toast('error', 'Napisz, co poprawić na obrazie.');
      return;
    }
    await onSubmit({
      instruction: instruction.trim(),
      model,
      references: references.map((r) => r.file),
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Podgląd obrazu */}
      <Card className="overflow-hidden p-4">
        <div className="mx-auto w-fit max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Obraz do edycji"
            className="block max-h-[66dvh] w-auto max-w-full rounded-lg"
            draggable={false}
          />
        </div>
      </Card>

      {/* Panel instrukcji */}
      <div className="space-y-4">
        <Card className="p-4">
          <label className="mb-1.5 block text-sm font-medium">Co poprawić na obrazie?</label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={4}
            maxLength={2000}
            autoFocus
            placeholder="np. wygładź pogniecioną metkę na materacu — logo, kolor i kształt metki mają zostać bez zmian"
            className="w-full rounded-xl border border-studio-border bg-studio-surface px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-studio-muted/60 focus:border-studio-accent"
          />
          <p className="mt-1.5 text-xs text-studio-muted">
            Bez pędzla — opisz element i zmianę, model sam go znajdzie. Napisz też, co ma zostać
            nietknięte (np. „logo bez zmian").
          </p>

          <p className="mb-1.5 mt-3 text-sm font-medium">
            Obrazy referencyjne{' '}
            <span className="font-normal text-studio-muted">(opcjonalnie, do {MAX_EDIT_REFERENCES})</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {references.map((r, i) => (
              <div key={r.url} className="relative h-16 w-16 overflow-hidden rounded-lg border border-studio-border bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt="" className="h-full w-full object-contain" />
                <button
                  onClick={() => removeReference(i)}
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black"
                  aria-label="Usuń referencję"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {references.length < MAX_EDIT_REFERENCES && (
              <button
                onClick={() => refInputRef.current?.click()}
                className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-studio-border text-studio-muted transition-colors hover:border-studio-accent hover:text-studio-accent"
                title="Dodaj obraz referencyjny"
              >
                <ImagePlus className="h-5 w-5" />
              </button>
            )}
            <input
              ref={refInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                addReferences(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-studio-muted">
            Model edycji
          </p>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as StudioModelId)}
            aria-label="Model edycji opisowej"
            className="w-full rounded-xl border border-studio-border bg-studio-surface px-3 py-2.5 text-sm outline-none focus:border-studio-accent"
          >
            <optgroup label="★ Polecane do edycji opisowej (Google)">
              {modelGroups.recommended.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.vendor})
                </option>
              ))}
            </optgroup>
            {modelGroups.other.length > 0 && (
              <optgroup label="Pozostałe">
                {modelGroups.other.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.vendor})
                  </option>
                ))}
              </optgroup>
            )}
            {modelGroups.legacy.length > 0 && (
              <optgroup label="Starsze">
                {modelGroups.legacy.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.vendor})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {(() => {
            const m = STUDIO_MODELS.find((x) => x.id === model);
            if (!m) return null;
            return (
              <div className="mt-2 space-y-1.5">
                <div className="flex flex-wrap gap-1">
                  {m.provider === 'gemini' && <Badge tone="accent">polecany do opisowej</Badge>}
                  <Badge>~{m.estimatedSeconds} s</Badge>
                </div>
                <p className="text-xs leading-relaxed text-studio-muted">
                  {m.provider === 'gemini'
                    ? 'Modele Google widzą cały obraz i precyzyjnie wykonują instrukcje tekstowe — pierwszy wybór, gdy nie zaznaczasz obszaru pędzlem.'
                    : 'Modele OpenAI działają najlepiej z maską pędzla; w trybie opisowym mogą zmienić więcej, niż prosisz.'}
                </p>
              </div>
            );
          })()}
          <ModelGuide context="edit" className="mt-3" />
        </Card>

        <Button onClick={handleSubmit} disabled={busy} className="w-full py-3">
          {busy ? <Spinner className="h-5 w-5 text-white" /> : <Wand2 className="h-5 w-5" />}
          Popraw według opisu
        </Button>
        <p className="text-center text-xs text-studio-muted">
          Wynik zapisze się jako nowa wersja podpięta do oryginału.
        </p>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brush, Eraser, ImagePlus, Trash2, Undo2, Wand2, X } from 'lucide-react';
import { useToast } from '@/components/studio/toast';
import { Badge, Button, Card, Spinner } from '@/components/studio/ui';
import { DEFAULT_EDIT_MODEL, STUDIO_MODELS, type StudioModelId } from '@/lib/studio/models';
import { cn } from '@/lib/utils';

type Tool = 'brush' | 'eraser';

interface StrokePoint {
  x: number;
  y: number;
}

interface Stroke {
  tool: Tool;
  /** Rozmiar pędzla w pikselach NATYWNYCH obrazu. */
  size: number;
  points: StrokePoint[];
}

export interface MaskEditorSubmit {
  mask: Blob;
  annotated: Blob;
  instruction: string;
  model: StudioModelId;
  /** Packshoty/zdjęcia produktów do wstawienia w zaznaczony obszar. */
  references: File[];
}

const MAX_EDIT_REFERENCES = 4;

/**
 * Edytor maski: warstwa 1 = obraz (<img>), warstwa 2 = maska rysowana pędzlem.
 *
 * Kluczowe decyzje, dzięki którym pędzel działa niezależnie od DPR/zoomu:
 * - canvas maski ma zawsze NATYWNĄ rozdzielczość obrazu (naturalWidth ×
 *   naturalHeight), a do rozmiaru okna skalowany jest wyłącznie przez CSS;
 *   współrzędne wskaźnika mapujemy przez getBoundingClientRect → piksele natywne,
 * - pointer events (mysz + rysik + dotyk), z setPointerCapture i touch-action:none,
 * - maska rysowana jest kryjącą czerwienią (alpha 1), a półprzezroczysty podgląd
 *   (rgba(255,0,0,0.4)) uzyskujemy przez opacity na elemencie canvas — dzięki temu
 *   nakładające się pociągnięcia nie ciemnieją, a eksporty są deterministyczne.
 */
export function MaskEditor({
  imageUrl,
  onSubmit,
  busy,
  defaultModel = DEFAULT_EDIT_MODEL,
}: {
  imageUrl: string;
  onSubmit: (payload: MaskEditorSubmit) => void | Promise<void>;
  busy: boolean;
  defaultModel?: StudioModelId;
}) {
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [imageReady, setImageReady] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const [tool, setTool] = useState<Tool>('brush');
  const [brushSize, setBrushSize] = useState(40);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [instruction, setInstruction] = useState('');
  const [references, setReferences] = useState<{ file: File; url: string }[]>([]);
  const refInputRef = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState<StudioModelId>(defaultModel);

  const currentStroke = useRef<Stroke | null>(null);
  const drawing = useRef(false);

  // Ładowanie obrazu (same-origin proxy → brak problemów CORS przy eksporcie).
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      setImageReady(true);
    };
    img.onerror = () => toast('error', 'Nie udało się załadować obrazu do edycji.');
    img.src = imageUrl;
  }, [imageUrl, toast]);

  // Inicjalizacja canvasu maski w natywnej rozdzielczości.
  useEffect(() => {
    if (!natural || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = natural.w;
    canvas.height = natural.h;
  }, [natural]);

  /** Rysuje miękki stempel pędzla (radialny gradient) w punkcie. */
  const stamp = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, size: number, erase: boolean) => {
    const r = size / 2;
    ctx.save();
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    const grad = ctx.createRadialGradient(x, y, r * 0.5, x, y, r);
    grad.addColorStop(0, erase ? 'rgba(0,0,0,1)' : 'rgba(255,0,0,1)');
    grad.addColorStop(1, erase ? 'rgba(0,0,0,0)' : 'rgba(255,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, []);

  /** Rysuje pociągnięcie: stemple wzdłuż łamanej co ~1/5 rozmiaru pędzla. */
  const drawStroke = useCallback(
    (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
      const erase = stroke.tool === 'eraser';
      const step = Math.max(1, stroke.size / 5);
      let prev: StrokePoint | null = null;
      for (const point of stroke.points) {
        if (!prev) {
          stamp(ctx, point.x, point.y, stroke.size, erase);
        } else {
          const dist = Math.hypot(point.x - prev.x, point.y - prev.y);
          const steps = Math.max(1, Math.floor(dist / step));
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            stamp(ctx, prev.x + (point.x - prev.x) * t, prev.y + (point.y - prev.y) * t, stroke.size, erase);
          }
        }
        prev = point;
      }
    },
    [stamp]
  );

  /** Pełny redraw maski z listy pociągnięć (używany przy undo/clear). */
  const redraw = useCallback(
    (allStrokes: Stroke[]) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of allStrokes) drawStroke(ctx, s);
    },
    [drawStroke]
  );

  /** Mapowanie współrzędnych wskaźnika → piksele natywne obrazu. */
  const toNative = useCallback(
    (e: React.PointerEvent): StrokePoint | null => {
      const canvas = canvasRef.current;
      if (!canvas || !natural) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return {
        x: ((e.clientX - rect.left) / rect.width) * natural.w,
        y: ((e.clientY - rect.top) / rect.height) * natural.h,
      };
    },
    [natural]
  );

  /** Skala: piksele natywne na 1 piksel ekranu (do przeliczenia rozmiaru pędzla). */
  const nativeScale = useCallback((): number => {
    const canvas = canvasRef.current;
    if (!canvas || !natural) return 1;
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 ? natural.w / rect.width : 1;
  }, [natural]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (busy) return;
      const point = toNative(e);
      if (!point) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = true;
      const stroke: Stroke = {
        tool,
        size: Math.max(2, brushSize * nativeScale()),
        points: [point],
      };
      currentStroke.current = stroke;
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) stamp(ctx, point.x, point.y, stroke.size, tool === 'eraser');
    },
    [busy, toNative, tool, brushSize, nativeScale, stamp]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawing.current || !currentStroke.current) return;
      const point = toNative(e);
      if (!point) return;
      const stroke = currentStroke.current;
      const prev = stroke.points[stroke.points.length - 1];
      stroke.points.push(point);
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        drawStroke(ctx, { ...stroke, points: [prev, point] });
      }
    },
    [toNative, drawStroke]
  );

  const handlePointerUp = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    const stroke = currentStroke.current;
    currentStroke.current = null;
    if (stroke && stroke.points.length > 0) {
      setStrokes((prev) => [...prev, stroke]);
    }
  }, []);

  const handleUndo = useCallback(() => {
    setStrokes((prev) => {
      const next = prev.slice(0, -1);
      redraw(next);
      return next;
    });
  }, [redraw]);

  const handleClear = useCallback(() => {
    setStrokes([]);
    redraw([]);
  }, [redraw]);

  // Ctrl+Z / Cmd+Z — pełna historia kroków.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo]);

  const hasMask = strokes.some((s) => s.tool === 'brush');

  /** Eksport masek w NATYWNEJ rozdzielczości obrazu. */
  const exportMasks = useCallback(async (): Promise<{ mask: Blob; annotated: Blob } | null> => {
    const img = imageRef.current;
    const maskCanvas = canvasRef.current;
    if (!img || !maskCanvas || !natural) return null;

    // 1) Maska OpenAI: zaznaczony obszar = przezroczysty, reszta kryjąca.
    const maskOut = document.createElement('canvas');
    maskOut.width = natural.w;
    maskOut.height = natural.h;
    const mctx = maskOut.getContext('2d')!;
    mctx.fillStyle = '#000000';
    mctx.fillRect(0, 0, natural.w, natural.h);
    mctx.globalCompositeOperation = 'destination-out';
    mctx.drawImage(maskCanvas, 0, 0);

    // 2) Annotacja Gemini: oryginał + półprzezroczysta czerwona maska.
    const annOut = document.createElement('canvas');
    annOut.width = natural.w;
    annOut.height = natural.h;
    const actx = annOut.getContext('2d')!;
    actx.drawImage(img, 0, 0, natural.w, natural.h);
    actx.globalAlpha = 0.4;
    actx.drawImage(maskCanvas, 0, 0);
    actx.globalAlpha = 1;

    const toBlob = (canvas: HTMLCanvasElement) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    const [mask, annotated] = await Promise.all([toBlob(maskOut), toBlob(annOut)]);
    if (!mask || !annotated) return null;
    return { mask, annotated };
  }, [natural]);

  function addReferences(files: FileList | null) {
    if (!files) return;
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    setReferences((prev) => {
      const next = [...prev];
      for (const f of [...files]) {
        if (next.length >= MAX_EDIT_REFERENCES) break;
        if (!allowed.includes(f.type) || f.size > 20 * 1024 * 1024) continue;
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
    if (!hasMask) {
      toast('error', 'Zaznacz pędzlem obszar do zmiany.');
      return;
    }
    if (!instruction.trim() && references.length === 0) {
      toast('error', 'Opisz, co zmienić w zaznaczonym obszarze, albo dodaj obraz referencyjny.');
      return;
    }
    const exported = await exportMasks();
    if (!exported) {
      toast('error', 'Eksport maski nie powiódł się.');
      return;
    }
    await onSubmit({
      ...exported,
      instruction: instruction.trim(),
      model,
      references: references.map((r) => r.file),
    });
  }

  const editModels = useMemo(() => STUDIO_MODELS, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Obszar roboczy */}
      <Card className="overflow-hidden p-4">
        {!imageReady ? (
          <div className="flex h-96 items-center justify-center">
            <Spinner className="h-8 w-8" />
          </div>
        ) : (
          <div
            ref={containerRef}
            className="relative mx-auto w-fit max-w-full select-none"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Edytowany obraz"
              className="block max-h-[70vh] w-auto max-w-full rounded-lg"
              draggable={false}
            />
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className={cn(
                'absolute inset-0 h-full w-full rounded-lg opacity-40',
                busy ? 'cursor-not-allowed' : 'cursor-crosshair'
              )}
              style={{ touchAction: 'none' }}
            />
          </div>
        )}
      </Card>

      {/* Panel narzędzi */}
      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Button
              variant={tool === 'brush' ? 'primary' : 'secondary'}
              onClick={() => setTool('brush')}
              className="flex-1"
            >
              <Brush className="h-4 w-4" /> Pędzel
            </Button>
            <Button
              variant={tool === 'eraser' ? 'primary' : 'secondary'}
              onClick={() => setTool('eraser')}
              className="flex-1"
            >
              <Eraser className="h-4 w-4" /> Gumka
            </Button>
          </div>

          <label className="mb-1 mt-4 flex items-center justify-between text-xs font-medium text-studio-muted">
            Rozmiar pędzla <span>{brushSize} px</span>
          </label>
          <input
            type="range"
            min={10}
            max={150}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-full accent-studio-accent"
          />

          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={handleUndo}
              disabled={strokes.length === 0}
              className="flex-1"
              title="Ctrl+Z"
            >
              <Undo2 className="h-4 w-4" /> Cofnij
            </Button>
            <Button
              variant="secondary"
              onClick={handleClear}
              disabled={strokes.length === 0}
              className="flex-1"
            >
              <Trash2 className="h-4 w-4" /> Wyczyść
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <label className="mb-1.5 block text-sm font-medium">
            Co zmienić w zaznaczonym obszarze?
          </label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={
              references.length > 0
                ? 'opcjonalnie — np. ustaw je symetrycznie po obu stronach łóżka'
                : 'np. zmień poduszki na lniane, beżowe'
            }
            className="w-full rounded-xl border border-studio-border bg-white px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-studio-muted/60 focus:border-studio-accent"
          />

          <p className="mb-1.5 mt-3 text-sm font-medium">
            Obrazy referencyjne <span className="font-normal text-studio-muted">(opcjonalnie, do {MAX_EDIT_REFERENCES})</span>
          </p>
          <p className="mb-2 text-xs text-studio-muted">
            np. packshoty lamp czy roślin — model wstawi dokładnie te produkty w zaznaczone miejsce.
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
          <div className="space-y-2">
            {editModels.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-xl border-2 p-3 text-left transition-all',
                  model === m.id
                    ? 'border-studio-accent bg-studio-accent-soft'
                    : 'border-studio-border hover:border-studio-accent/50'
                )}
              >
                <span className="flex items-center justify-between text-sm font-semibold">
                  {m.label}
                  {m.supportsNativeMask ? (
                    <Badge tone="accent">natywna maska</Badge>
                  ) : (
                    <Badge>technika adnotacji</Badge>
                  )}
                </span>
                <span className="text-xs text-studio-muted">{m.whenToUse}</span>
              </button>
            ))}
          </div>
        </Card>

        <Button onClick={handleSubmit} disabled={busy} className="w-full py-3">
          {busy ? <Spinner className="h-5 w-5 text-white" /> : <Wand2 className="h-5 w-5" />}
          Zastosuj zmianę
        </Button>
        <p className="text-center text-xs text-studio-muted">
          Wynik zapisze się jako nowa wersja podpięta do oryginału.
        </p>
      </div>
    </div>
  );
}

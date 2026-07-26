'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ImagePlus, Star, Trash2, X } from 'lucide-react';
import { useToast } from '@/components/studio/toast';
import { Badge, Button, Card, EmptyState, PageTitle, Spinner } from '@/components/studio/ui';
import { apiGet, apiJson } from '@/lib/studio/client';
import { cn } from '@/lib/utils';
import type { InspirationImageRow, InspirationSetRow, RoomRow } from '@/lib/studio/types';

interface SetDetail extends InspirationSetRow {
  room_name: string | null;
}
interface ImageItem extends InspirationImageRow {
  image_url: string;
}

export function InspirationSetClient({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [set, setSet] = useState<SetDetail | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([
        apiGet<{ set: SetDetail; images: ImageItem[] }>(`/api/studio/inspirations/${id}`),
        apiGet<{ rooms: RoomRow[] }>('/api/studio/rooms'),
      ]);
      setSet(d.set);
      setImages(d.images);
      setRooms(r.rooms);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się pobrać zestawu.');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUpload(files: FileList | File[]) {
    const list = [...files];
    if (list.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of list) form.append('files', f);
      const res = await fetch(`/api/studio/inspirations/${id}/images`, {
        method: 'POST',
        body: form,
      });
      const json = (await res.json()) as {
        images?: ImageItem[];
        errors?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? 'Upload nie powiódł się.');
      if (json.errors?.length) toast('error', `Część plików pominięto: ${json.errors.join('; ')}`);
      if (json.images?.length) toast('success', `Wgrano ${json.images.length} obrazów.`);
      await load();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Upload nie powiódł się.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteImage(imageId: string) {
    try {
      const res = await fetch(`/api/studio/inspirations/${id}/images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? 'Usuwanie nie powiodło się.');
      }
      setImages((prev) => prev.filter((i) => i.id !== imageId));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Usuwanie nie powiodło się.');
    }
  }

  async function handleSetCover(imageId: string) {
    try {
      await apiJson(`/api/studio/inspirations/${id}`, 'PATCH', { coverImageId: imageId });
      setSet((prev) => (prev ? { ...prev, cover_image_id: imageId } : prev));
      toast('success', 'Ustawiono okładkę zestawu.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się ustawić okładki.');
    }
  }

  async function handleRoomChange(roomId: string) {
    try {
      await apiJson(`/api/studio/inspirations/${id}`, 'PATCH', { roomId: roomId || null });
      toast('success', roomId ? 'Przypisano zestaw do pokoju.' : 'Usunięto przypisanie do pokoju.');
      await load();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się zapisać.');
    }
  }

  async function handleTrash() {
    try {
      await apiJson(`/api/studio/inspirations/${id}`, 'PATCH', { action: 'trash' });
      toast('success', 'Zestaw przeniesiony do kosza.');
      router.push('/studio/inspirations');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się usunąć.');
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (!set) return <p className="text-sm text-studio-muted">Nie znaleziono zestawu.</p>;

  return (
    <div>
      <Link
        href="/studio/inspirations"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-studio-muted transition-colors hover:text-studio-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Inspiracje
      </Link>
      <PageTitle
        title={set.name}
        subtitle={set.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={set.room_id ?? ''}
              onChange={(e) => handleRoomChange(e.target.value)}
              className="rounded-xl border border-studio-border bg-white px-3 py-2 text-sm outline-none focus:border-studio-accent"
              title="Zestaw podpowie się przy wyborze tego pokoju"
            >
              <option value="">Bez przypisania do pokoju</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <Button variant="ghost" onClick={handleTrash} title="Przenieś do kosza">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleUpload(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'mb-6 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
          dragOver
            ? 'border-studio-accent bg-studio-accent-soft'
            : 'border-studio-border hover:border-studio-accent/50'
        )}
      >
        {uploading ? <Spinner className="h-8 w-8" /> : <ImagePlus className="h-8 w-8 text-studio-muted" />}
        <p className="text-sm font-medium">Przeciągnij obrazy albo kliknij (można wiele naraz)</p>
        <p className="text-xs text-studio-muted">PNG, JPG lub WEBP, do 20 MB każdy</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleUpload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {images.length === 0 ? (
        <EmptyState
          title="Zestaw jest pusty"
          hint="Wgraj obrazy referencyjne — zdjęcia wnętrz, materiały, palety kolorów."
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img) => (
            <Card key={img.id} className="group relative overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.image_url}
                alt=""
                className="aspect-square w-full object-cover"
                loading="lazy"
              />
              {set.cover_image_id === img.id && (
                <span className="absolute left-2 top-2">
                  <Badge tone="accent">
                    <Star className="h-3 w-3" /> okładka
                  </Badge>
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/50 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                {set.cover_image_id !== img.id && (
                  <button
                    onClick={() => handleSetCover(img.id)}
                    className="rounded-lg bg-white/90 p-1.5 text-studio-ink transition-colors hover:bg-white"
                    title="Ustaw jako okładkę"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => handleDeleteImage(img.id)}
                  className="rounded-lg bg-white/90 p-1.5 text-red-600 transition-colors hover:bg-white"
                  title="Usuń obraz"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

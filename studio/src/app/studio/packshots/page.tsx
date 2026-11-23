'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ImagePlus, Images, Pencil, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useToast } from '@/components/studio/toast';
import { Card, EmptyState, PageTitle, Spinner } from '@/components/studio/ui';
import { apiGet, apiJson, formatDate } from '@/lib/studio/client';
import {
  getBrowserUserId,
  readImageDimensions,
  uploadToStorageFromBrowser,
} from '@/lib/studio/supabase-browser';
import { extForMime, validateImageFile } from '@/lib/studio/upload-limits';
import { cn } from '@/lib/utils';
import type { PackshotRow } from '@/lib/studio/types';

interface PackshotItem extends PackshotRow {
  image_url: string;
}

export default function PackshotsPage() {
  const { toast } = useToast();
  const [packshots, setPackshots] = useState<PackshotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const debounceRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => setDebounced(search), 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debounced) params.set('q', debounced);
      const d = await apiGet<{ packshots: PackshotItem[] }>(
        `/api/studio/packshots?${params.toString()}`
      );
      setPackshots(d.packshots);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się pobrać packshotów.');
    } finally {
      setLoading(false);
    }
  }, [debounced, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      try {
        for (const file of files) {
          const invalid = validateImageFile(file);
          if (invalid) {
            toast('error', `${file.name}: ${invalid}.`);
            continue;
          }
          const dims = await readImageDimensions(file);
          const userId = await getBrowserUserId();
          const path = `${userId}/${crypto.randomUUID()}.${extForMime(file.type)}`;
          await uploadToStorageFromBrowser('packshots', path, file, file.type);
          const res = await apiJson<{ packshot: PackshotItem }>('/api/studio/packshots', 'POST', {
            path,
            originalFilename: file.name,
            width: dims.width,
            height: dims.height,
          });
          setPackshots((prev) => [res.packshot, ...prev]);
        }
        toast('success', files.length > 1 ? 'Packshoty wgrane.' : 'Packshot wgrany.');
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Upload nie powiódł się.');
      } finally {
        setUploading(false);
      }
    },
    [toast]
  );

  async function handleRename(id: string) {
    const name = renameValue.trim();
    if (!name) return setRenamingId(null);
    try {
      await apiJson(`/api/studio/packshots/${id}`, 'PATCH', { action: 'rename', name });
      setPackshots((prev) => prev.map((p) => (p.id === id ? { ...p, original_filename: name } : p)));
      setRenamingId(null);
      toast('success', 'Nazwa zapisana.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się zmienić nazwy.');
    }
  }

  async function handleTrash(p: PackshotItem) {
    try {
      await apiJson(`/api/studio/packshots/${p.id}`, 'PATCH', { action: 'trash' });
      setPackshots((prev) => prev.filter((x) => x.id !== p.id));
      toast('success', 'Packshot przeniesiony do kosza.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się przenieść do kosza.');
    }
  }

  return (
    <div>
      <PageTitle
        title="Packshoty"
        subtitle="Twoja baza zdjęć produktów — wgrywaj, nazywaj, używaj w kreatorze."
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
          const files = [...e.dataTransfer.files];
          if (files.length) void handleUpload(files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'mb-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
          dragOver
            ? 'border-studio-accent bg-studio-accent-soft'
            : 'border-studio-border hover:border-studio-accent/50'
        )}
      >
        {uploading ? <Spinner className="h-8 w-8" /> : <ImagePlus className="h-8 w-8 text-studio-muted" />}
        <p className="text-sm font-medium text-studio-ink">
          Przeciągnij packshoty albo kliknij, żeby wybrać pliki
        </p>
        <p className="text-xs text-studio-muted">PNG, JPG lub WEBP, do 20 MB każdy</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files ? [...e.target.files] : [];
            if (files.length) void handleUpload(files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="relative mb-6 w-full sm:w-72">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-studio-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Szukaj po nazwie pliku…"
          className="w-full rounded-xl border border-studio-border bg-studio-surface py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-studio-muted/60 focus:border-studio-accent"
        />
      </div>

      {loading && packshots.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : packshots.length === 0 ? (
        <EmptyState
          icon={<Images className="h-10 w-10" />}
          title={debounced ? 'Brak packshotów dla tej frazy' : 'Brak packshotów'}
          hint={debounced ? 'Zmień wyszukiwanie.' : 'Wgraj pierwsze zdjęcie produktu powyżej.'}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {packshots.map((p) => (
            <Card key={p.id} className="group overflow-hidden">
              {/* Jasne tło pod packshotem — przezroczyste PNG są czytelne. */}
              <div className="relative aspect-square bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${p.image_url}&w=320`}
                  alt={p.original_filename ?? 'packshot'}
                  className="h-full w-full object-contain p-2"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <Link
                    href={`/studio/new?packshot=${p.id}`}
                    title="Użyj w nowej wizualizacji"
                    className="rounded-full bg-studio-accent p-2 text-white transition-colors hover:bg-studio-accent-dark"
                  >
                    <Sparkles className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={() => {
                      setRenamingId(p.id);
                      setRenameValue(p.original_filename ?? '');
                    }}
                    title="Zmień nazwę"
                    className="rounded-full bg-studio-surface p-2 text-studio-ink transition-colors hover:bg-studio-border"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleTrash(p)}
                    title="Przenieś do kosza"
                    className="rounded-full bg-studio-surface p-2 text-studio-ink transition-colors hover:bg-red-600 hover:text-white"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="p-2.5">
                {renamingId === p.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleRename(p.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      maxLength={300}
                      autoFocus
                      aria-label="Nowa nazwa packshota"
                      className="w-full min-w-0 rounded-lg border border-studio-border bg-studio-surface px-2 py-1 text-xs outline-none focus:border-studio-accent"
                    />
                    <button
                      onClick={() => handleRename(p.id)}
                      className="shrink-0 rounded-md p-1 text-emerald-400 hover:bg-studio-bg"
                      aria-label="Zapisz nazwę"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setRenamingId(null)}
                      className="shrink-0 rounded-md p-1 text-studio-muted hover:bg-studio-bg"
                      aria-label="Anuluj"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <p className="truncate text-xs font-medium" title={p.original_filename ?? undefined}>
                    {p.original_filename ?? 'Bez nazwy'}
                  </p>
                )}
                <p className="mt-0.5 text-[11px] text-studio-muted">
                  {p.width && p.height ? `${p.width}×${p.height} · ` : ''}
                  {formatDate(p.created_at)}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

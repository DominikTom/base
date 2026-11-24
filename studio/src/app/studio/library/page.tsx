'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Layers, Library as LibraryIcon, Search, Star, X } from 'lucide-react';
import { useToast } from '@/components/studio/toast';
import { Badge, Button, Card, EmptyState, PageTitle, Spinner, StatusBadge } from '@/components/studio/ui';
import { apiGet, apiJson, formatDate } from '@/lib/studio/client';
import { STUDIO_MODELS } from '@/lib/studio/models';
import { cn } from '@/lib/utils';
import type { GenerationView, RoomRow } from '@/lib/studio/types';

interface SetOption {
  id: string;
  name: string;
}
interface AuthorOption {
  id: string;
  display_name: string | null;
}

const PAGE_SIZE = 48;

/** Miniatura z transformacją po stronie Storage — siatka nie ściąga pełnych 2K/4K. */
function thumbUrl(url: string | null, width: number): string | null {
  return url ? `${url}&w=${width}` : null;
}

/** Element siatki: pojedyncza generacja albo zgrupowana seria (batch). */
type GridItem =
  | { kind: 'single'; g: GenerationView }
  | { kind: 'batch'; batchId: string; items: GenerationView[] };

export default function LibraryPage() {
  const { toast } = useToast();
  const [generations, setGenerations] = useState<GenerationView[]>([]);
  const [total, setTotal] = useState(0);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [sets, setSets] = useState<SetOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filtry inicjalizowane z URL — link do przefiltrowanej biblioteki da się udostępnić.
  const initial = useRef<URLSearchParams | null>(null);
  if (initial.current === null) {
    initial.current =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  }
  const init = initial.current;

  const [room, setRoom] = useState(init.get('room') ?? '');
  const [model, setModel] = useState(init.get('model') ?? '');
  const [setFilter, setSetFilter] = useState(init.get('set') ?? '');
  const [author, setAuthor] = useState(init.get('author') ?? '');
  const [dateFrom, setDateFrom] = useState(init.get('from') ?? '');
  const [dateTo, setDateTo] = useState(init.get('to') ?? '');
  const [favOnly, setFavOnly] = useState(init.get('fav') === '1');
  const [groupSeries, setGroupSeries] = useState(init.get('group') !== '0');
  const [search, setSearch] = useState(init.get('q') ?? '');
  const searchDebounce = useRef<number | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(init.get('q') ?? '');

  useEffect(() => {
    if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    searchDebounce.current = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => {
      if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    };
  }, [search]);

  const filterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (room) params.set('room', room);
    if (model) params.set('model', model);
    if (setFilter) params.set('set', setFilter);
    if (author) params.set('author', author);
    if (favOnly) params.set('fav', '1');
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    return params;
  }, [room, model, setFilter, author, favOnly, debouncedSearch, dateFrom, dateTo]);

  // Stan filtrów → URL (bez przeładowania i bez wpisu w historii).
  useEffect(() => {
    const params = filterParams();
    if (!groupSeries) params.set('group', '0');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [filterParams, groupSeries]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterParams();
      if (params.get('from')) params.set('from', `${params.get('from')}T00:00:00`);
      if (params.get('to')) params.set('to', `${params.get('to')}T23:59:59`);
      params.set('limit', String(PAGE_SIZE));
      const d = await apiGet<{ generations: GenerationView[]; total: number }>(
        `/api/studio/generations?${params.toString()}`
      );
      setGenerations(d.generations);
      setTotal(d.total ?? d.generations.length);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się pobrać biblioteki.');
    } finally {
      setLoading(false);
    }
  }, [filterParams, toast]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const params = filterParams();
      if (params.get('from')) params.set('from', `${params.get('from')}T00:00:00`);
      if (params.get('to')) params.set('to', `${params.get('to')}T23:59:59`);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(generations.length));
      const d = await apiGet<{ generations: GenerationView[]; total: number }>(
        `/api/studio/generations?${params.toString()}`
      );
      setGenerations((prev) => {
        const seen = new Set(prev.map((g) => g.id));
        return [...prev, ...d.generations.filter((g) => !seen.has(g.id))];
      });
      setTotal(d.total ?? 0);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się doczytać wyników.');
    } finally {
      setLoadingMore(false);
    }
  }, [filterParams, generations.length, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Odświeżanie, dopóki są generacje w toku.
  useEffect(() => {
    if (!generations.some((g) => g.status === 'pending')) return;
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [generations, load]);

  useEffect(() => {
    Promise.all([
      apiGet<{ rooms: RoomRow[] }>('/api/studio/rooms'),
      apiGet<{ sets: SetOption[] }>('/api/studio/inspirations'),
    ])
      .then(([r, s]) => {
        setRooms(r.rooms);
        setSets(s.sets);
      })
      .catch(() => {});
  }, []);

  const authors = useMemo<AuthorOption[]>(() => {
    const map = new Map<string, string | null>();
    for (const g of generations) map.set(g.user_id, g.author_name ?? null);
    return [...map.entries()].map(([id, display_name]) => ({ id, display_name }));
  }, [generations]);

  /** Grupowanie serii: generacje z tym samym batch_id składają się w jedną kartę. */
  const items = useMemo<GridItem[]>(() => {
    if (!groupSeries) return generations.map((g) => ({ kind: 'single', g }));
    const out: GridItem[] = [];
    const batchIndex = new Map<string, number>();
    for (const g of generations) {
      if (!g.batch_id) {
        out.push({ kind: 'single', g });
        continue;
      }
      const idx = batchIndex.get(g.batch_id);
      if (idx === undefined) {
        batchIndex.set(g.batch_id, out.length);
        out.push({ kind: 'batch', batchId: g.batch_id, items: [g] });
      } else {
        (out[idx] as Extract<GridItem, { kind: 'batch' }>).items.push(g);
      }
    }
    // Seria z jedną widoczną pozycją zachowuje się jak zwykła karta.
    return out.map((it) => (it.kind === 'batch' && it.items.length === 1 ? { kind: 'single', g: it.items[0] } : it));
  }, [generations, groupSeries]);

  async function toggleFavorite(g: GenerationView) {
    try {
      await apiJson(`/api/studio/generations/${g.id}`, 'PATCH', {
        action: g.is_favorite ? 'unfavorite' : 'favorite',
      });
      setGenerations((prev) =>
        prev.map((x) => (x.id === g.id ? { ...x, is_favorite: !g.is_favorite } : x))
      );
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się oznaczyć.');
    }
  }

  const hasFilters = Boolean(room || model || setFilter || author || search || dateFrom || dateTo || favOnly);

  const selectCls =
    'rounded-xl border border-studio-border bg-studio-surface px-3 py-2 text-sm outline-none transition-colors focus:border-studio-accent';

  return (
    <div>
      <PageTitle
        title="Biblioteka"
        subtitle="Twoje wizualizacje i te udostępnione zespołowi — filtruj, przeglądaj, pobieraj."
      />

      {/* Filtry */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-studio-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj po uwagach i promptach…"
            className="w-full rounded-xl border border-studio-border bg-studio-surface py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-studio-muted/60 focus:border-studio-accent sm:w-64"
          />
        </div>
        <select value={room} onChange={(e) => setRoom(e.target.value)} className={selectCls} aria-label="Filtr: pokój">
          <option value="">Pokój: wszystkie</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select value={model} onChange={(e) => setModel(e.target.value)} className={selectCls} aria-label="Filtr: model">
          <option value="">Model: wszystkie</option>
          {STUDIO_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <select value={setFilter} onChange={(e) => setSetFilter(e.target.value)} className={selectCls} aria-label="Filtr: inspiracje">
          <option value="">Inspiracje: wszystkie</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={author} onChange={(e) => setAuthor(e.target.value)} className={selectCls} aria-label="Filtr: autor">
          <option value="">Autor: wszyscy</option>
          {authors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name ?? 'Bez nazwy'}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className={selectCls}
          title="Data od"
          aria-label="Data od"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className={selectCls}
          title="Data do"
          aria-label="Data do"
        />
        <button
          onClick={() => setFavOnly((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors',
            favOnly
              ? 'border-amber-500/50 bg-amber-500/15 font-medium text-amber-300 light:text-amber-700'
              : 'border-studio-border bg-studio-surface text-studio-muted hover:text-studio-ink'
          )}
        >
          <Star className={cn('h-4 w-4', favOnly && 'fill-current')} /> Ulubione
        </button>
        <button
          onClick={() => setGroupSeries((v) => !v)}
          title="Składaj generacje z jednej serii w jedną kartę"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors',
            groupSeries
              ? 'border-studio-accent/50 bg-studio-accent-soft font-medium text-studio-accent-dark'
              : 'border-studio-border bg-studio-surface text-studio-muted hover:text-studio-ink'
          )}
        >
          <Layers className="h-4 w-4" /> Grupuj serie
        </button>
        {hasFilters && (
          <button
            onClick={() => {
              setRoom('');
              setModel('');
              setSetFilter('');
              setAuthor('');
              setSearch('');
              setDateFrom('');
              setDateTo('');
              setFavOnly(false);
            }}
            className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm text-studio-muted transition-colors hover:bg-studio-accent-soft hover:text-studio-ink"
          >
            <X className="h-4 w-4" /> Wyczyść filtry
          </button>
        )}
      </div>

      {loading && generations.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : generations.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon className="h-10 w-10" />}
          title={hasFilters ? 'Brak wyników dla tych filtrów' : 'Biblioteka jest pusta'}
          hint={
            hasFilters
              ? 'Zmień kryteria wyszukiwania.'
              : 'Wygeneruj pierwszą wizualizację w sekcji „Nowa wizualizacja".'
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {items.map((item) =>
              item.kind === 'single' ? (
                <GenerationCard key={item.g.id} g={item.g} onToggleFavorite={toggleFavorite} />
              ) : (
                <BatchCard key={item.batchId} batchId={item.batchId} items={item.items} />
              )
            )}
          </div>
          {generations.length < total && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Spinner className="h-4 w-4" /> : null}
                Pokaż więcej
              </Button>
              <p className="text-xs text-studio-muted">
                {generations.length} z {total}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GenerationCard({
  g,
  onToggleFavorite,
}: {
  g: GenerationView;
  onToggleFavorite: (g: GenerationView) => void;
}) {
  return (
    <Card className="group relative overflow-hidden transition-shadow hover:shadow-md">
      <Link href={`/studio/generations/${g.id}`} className="block">
        <div className="relative aspect-[4/3] bg-studio-bg">
          {g.status === 'done' && g.image_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={thumbUrl(g.image_url, 640)!}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              {g.status === 'pending' ? (
                <Spinner className="h-6 w-6" />
              ) : (
                <span className="px-4 text-center text-xs text-red-400 light:text-red-600">
                  {g.error_message?.slice(0, 80) ?? 'Błąd'}
                </span>
              )}
            </div>
          )}
          <div className="absolute left-2 top-2">
            <StatusBadge status={g.status} />
          </div>
        </div>
        <div className="space-y-1 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">
              {g.room_name ??
                (g.edit_instruction
                  ? g.mask_storage_path
                    ? 'Edycja pędzlem'
                    : 'Korekty obrazu'
                  : 'Wizualizacja')}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {g.shared && <Badge tone="accent">wspólna</Badge>}
              <Badge>{STUDIO_MODELS.find((m) => m.id === g.model)?.label ?? g.model}</Badge>
            </span>
          </div>
          <p className="truncate text-xs text-studio-muted">
            {g.style_text ?? g.edit_instruction ?? g.set_name ?? '—'}
          </p>
          <p className="text-xs text-studio-muted">
            {formatDate(g.created_at)} · {g.author_name ?? '—'}
          </p>
        </div>
      </Link>
      <button
        onClick={() => onToggleFavorite(g)}
        title={g.is_favorite ? 'Usuń z ulubionych' : 'Oznacz jako ulubioną'}
        className={cn(
          'absolute right-2 top-2 rounded-full p-1.5 shadow transition-colors',
          g.is_favorite
            ? 'bg-amber-400 text-white'
            : 'bg-studio-surface/90 text-studio-muted opacity-0 group-hover:opacity-100 hover:text-amber-400'
        )}
      >
        <Star className={cn('h-4 w-4', g.is_favorite && 'fill-current')} />
      </button>
    </Card>
  );
}

/** Karta-serii: okładka + licznik, prowadzi do strony porównania serii. */
function BatchCard({ batchId, items }: { batchId: string; items: GenerationView[] }) {
  const done = items.filter((g) => g.status === 'done');
  const pending = items.filter((g) => g.status === 'pending');
  const cover = done.find((g) => g.image_url) ?? items[0];
  const first = items[items.length - 1];
  return (
    <div className="relative">
      {/* "Stos" pod kartą — sygnał wizualny serii */}
      <div className="absolute inset-x-1.5 -bottom-1 h-3 rounded-b-2xl border border-studio-border bg-studio-surface/70" aria-hidden />
      <Card className="group relative overflow-hidden transition-shadow hover:shadow-md">
        <Link href={`/studio/batch/${batchId}`} className="block">
          <div className="relative aspect-[4/3] bg-studio-bg">
            {cover.status === 'done' && cover.image_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={thumbUrl(cover.image_url, 640)!}
                alt=""
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                {pending.length > 0 ? (
                  <Spinner className="h-6 w-6" />
                ) : (
                  <span className="px-4 text-center text-xs text-red-400 light:text-red-600">Błąd serii</span>
                )}
              </div>
            )}
            <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
              <Layers className="h-3 w-3" /> Seria · {items.length}
            </div>
            {pending.length > 0 && (
              <div className="absolute right-2 top-2 rounded-full bg-amber-500/90 px-2 py-0.5 text-xs font-medium text-black">
                {done.length}/{items.length} gotowe
              </div>
            )}
          </div>
          <div className="space-y-1 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">
                Seria — {[...new Set(items.map((g) => g.room_name).filter(Boolean))].join(', ') || 'Wizualizacje'}
              </span>
              <Badge>{new Set(items.map((g) => g.model)).size} mod.</Badge>
            </div>
            <p className="truncate text-xs text-studio-muted">{first.style_text ?? first.set_name ?? '—'}</p>
            <p className="text-xs text-studio-muted">
              {formatDate(first.created_at)} · {first.author_name ?? '—'}
            </p>
          </div>
        </Link>
      </Card>
    </div>
  );
}

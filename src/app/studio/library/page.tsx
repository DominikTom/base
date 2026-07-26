'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Library as LibraryIcon, Search, X } from 'lucide-react';
import { useToast } from '@/components/studio/toast';
import { Badge, Card, EmptyState, PageTitle, Spinner, StatusBadge } from '@/components/studio/ui';
import { apiGet, formatDate } from '@/lib/studio/client';
import { STUDIO_MODELS } from '@/lib/studio/models';
import type { GenerationView, RoomRow } from '@/lib/studio/types';

interface SetOption {
  id: string;
  name: string;
}
interface AuthorOption {
  id: string;
  display_name: string | null;
}

export default function LibraryPage() {
  const { toast } = useToast();
  const [generations, setGenerations] = useState<GenerationView[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [sets, setSets] = useState<SetOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [room, setRoom] = useState('');
  const [model, setModel] = useState('');
  const [setFilter, setSetFilter] = useState('');
  const [author, setAuthor] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const searchDebounce = useRef<number | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    searchDebounce.current = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => {
      if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    };
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (room) params.set('room', room);
      if (model) params.set('model', model);
      if (setFilter) params.set('set', setFilter);
      if (author) params.set('author', author);
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (dateFrom) params.set('from', `${dateFrom}T00:00:00`);
      if (dateTo) params.set('to', `${dateTo}T23:59:59`);
      const d = await apiGet<{ generations: GenerationView[] }>(
        `/api/studio/generations?${params.toString()}`
      );
      setGenerations(d.generations);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się pobrać biblioteki.');
    } finally {
      setLoading(false);
    }
  }, [room, model, setFilter, author, debouncedSearch, dateFrom, dateTo, toast]);

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

  const hasFilters = Boolean(room || model || setFilter || author || search || dateFrom || dateTo);

  const selectCls =
    'rounded-xl border border-studio-border bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-studio-accent';

  return (
    <div>
      <PageTitle
        title="Biblioteka"
        subtitle="Wszystkie wizualizacje zespołu — filtruj, przeglądaj, pobieraj."
      />

      {/* Filtry */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-studio-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj po uwagach i promptach…"
            className="w-64 rounded-xl border border-studio-border bg-white py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-studio-muted/60 focus:border-studio-accent"
          />
        </div>
        <select value={room} onChange={(e) => setRoom(e.target.value)} className={selectCls}>
          <option value="">Pokój: wszystkie</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select value={model} onChange={(e) => setModel(e.target.value)} className={selectCls}>
          <option value="">Model: wszystkie</option>
          {STUDIO_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <select value={setFilter} onChange={(e) => setSetFilter(e.target.value)} className={selectCls}>
          <option value="">Inspiracje: wszystkie</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={author} onChange={(e) => setAuthor(e.target.value)} className={selectCls}>
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
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className={selectCls}
          title="Data do"
        />
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {generations.map((g) => (
            <Link key={g.id} href={`/studio/generations/${g.id}`}>
              <Card className="group overflow-hidden transition-shadow hover:shadow-md">
                <div className="relative aspect-[4/3] bg-studio-bg">
                  {g.status === 'done' && g.image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={g.image_url}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      {g.status === 'pending' ? (
                        <Spinner className="h-6 w-6" />
                      ) : (
                        <span className="px-4 text-center text-xs text-red-600">
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
                      {g.room_name ?? (g.edit_instruction ? 'Edycja pędzlem' : 'Wizualizacja')}
                    </span>
                    <Badge>{STUDIO_MODELS.find((m) => m.id === g.model)?.label ?? g.model}</Badge>
                  </div>
                  <p className="truncate text-xs text-studio-muted">
                    {g.style_text ?? g.edit_instruction ?? g.set_name ?? '—'}
                  </p>
                  <p className="text-xs text-studio-muted">
                    {formatDate(g.created_at)} · {g.author_name ?? '—'}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

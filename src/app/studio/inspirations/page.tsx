'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Lightbulb, Plus } from 'lucide-react';
import { useToast } from '@/components/studio/toast';
import { Badge, Button, Card, EmptyState, PageTitle, Spinner } from '@/components/studio/ui';
import { apiGet, apiJson } from '@/lib/studio/client';
import type { InspirationSetRow, RoomRow } from '@/lib/studio/types';

interface SetItem extends InspirationSetRow {
  room_name: string | null;
  image_count: number;
  cover_url: string | null;
}

export default function InspirationsPage() {
  const { toast } = useToast();
  const [sets, setSets] = useState<SetItem[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [roomId, setRoomId] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        apiGet<{ sets: SetItem[] }>('/api/studio/inspirations'),
        apiGet<{ rooms: RoomRow[] }>('/api/studio/rooms'),
      ]);
      setSets(s.sets);
      setRooms(r.rooms);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się pobrać inspiracji.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (!name.trim()) return toast('error', 'Podaj nazwę zestawu.');
    setCreating(true);
    try {
      await apiJson('/api/studio/inspirations', 'POST', {
        name: name.trim(),
        description: description.trim() || undefined,
        roomId: roomId || null,
      });
      toast('success', 'Zestaw utworzony.');
      setName('');
      setDescription('');
      setRoomId('');
      setShowForm(false);
      await load();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się utworzyć zestawu.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <PageTitle
        title="Inspiracje"
        subtitle="Zestawy obrazów referencyjnych używane przy generowaniu."
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" /> Nowy zestaw
          </Button>
        }
      />

      {showForm && (
        <Card className="mb-6 space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nazwa zestawu, np. Japandi jasne"
              maxLength={200}
              className="rounded-xl border border-studio-border bg-white px-3 py-2.5 text-sm outline-none focus:border-studio-accent"
            />
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="rounded-xl border border-studio-border bg-white px-3 py-2.5 text-sm outline-none focus:border-studio-accent"
            >
              <option value="">Bez przypisania do pokoju</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Opis (opcjonalnie)"
            maxLength={1000}
            className="w-full rounded-xl border border-studio-border bg-white px-3 py-2.5 text-sm outline-none focus:border-studio-accent"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Anuluj
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Spinner className="h-4 w-4 text-white" />} Utwórz zestaw
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : sets.length === 0 ? (
        <EmptyState
          icon={<Lightbulb className="h-10 w-10" />}
          title="Brak zestawów inspiracji"
          hint="Utwórz zestaw i wgraj do niego zdjęcia wnętrz, palety kolorów, materiały — posłużą jako referencje przy generowaniu."
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {sets.map((s) => (
            <Link key={s.id} href={`/studio/inspirations/${s.id}`}>
              <Card className="group overflow-hidden transition-shadow hover:shadow-md">
                <div className="aspect-[4/3] bg-studio-bg">
                  {s.cover_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={s.cover_url}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-studio-muted">
                      <Lightbulb className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    <Badge>{s.image_count} obr.</Badge>
                  </div>
                  {s.room_name && <Badge tone="accent">{s.room_name}</Badge>}
                  {s.description && (
                    <p className="truncate text-xs text-studio-muted">{s.description}</p>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

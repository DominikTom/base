'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Dices, KeyRound, Pencil, Shield, ShieldOff, UserPlus, X } from 'lucide-react';
import { useToast } from '@/components/studio/toast';
import { Badge, Button, Card, EmptyState, PageTitle, Spinner } from '@/components/studio/ui';
import { apiGet, apiJson, formatDate } from '@/lib/studio/client';
import { cn } from '@/lib/utils';

interface AdminUserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
}

interface Me {
  id: string;
  isAdmin: boolean;
}

/** Czytelne hasło bez mylących znaków (0/O, 1/l/I) + znak specjalny. */
function generatePassword(): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const core = [...bytes].map((b) => charset[b % charset.length]).join('');
  return `${core.slice(0, 4)}-${core.slice(4, 8)}-${core.slice(8, 12)}!`;
}

export default function AdminPage() {
  const { toast } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  // Formularz nowego konta
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [asAdmin, setAsAdmin] = useState(false);
  const [creating, setCreating] = useState(false);
  /** Dane ostatnio utworzonego konta — do skopiowania i przekazania osobie. */
  const [lastCreated, setLastCreated] = useState<{ email: string; password: string } | null>(null);

  // Akcje w wierszach
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pwValue, setPwValue] = useState('');
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const m = await apiGet<Me>('/api/studio/me');
        setMe(m);
        if (!m.isAdmin) {
          setForbidden(true);
          return;
        }
        const d = await apiGet<{ users: AdminUserRow[] }>('/api/studio/admin/users');
        setUsers(d.users);
      } catch (err) {
        setForbidden(true);
        toast('error', err instanceof Error ? err.message : 'Nie udało się załadować panelu.');
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  async function handleCreate() {
    if (!name.trim()) return toast('error', 'Podaj imię / nazwę wyświetlaną.');
    if (!email.trim()) return toast('error', 'Podaj adres e-mail.');
    if (password.length < 8) return toast('error', 'Hasło musi mieć co najmniej 8 znaków.');
    setCreating(true);
    try {
      const res = await apiJson<{ user: AdminUserRow }>('/api/studio/admin/users', 'POST', {
        email: email.trim(),
        password,
        displayName: name.trim(),
        isAdmin: asAdmin,
      });
      setUsers((prev) =>
        [...prev, res.user].sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''))
      );
      setLastCreated({ email: res.user.email ?? email.trim(), password });
      setName('');
      setEmail('');
      setPassword('');
      setAsAdmin(false);
      toast('success', `Konto ${res.user.email} utworzone.`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się utworzyć konta.');
    } finally {
      setCreating(false);
    }
  }

  async function handleSetPassword(u: AdminUserRow) {
    if (pwValue.length < 8) return toast('error', 'Hasło musi mieć co najmniej 8 znaków.');
    setBusyId(u.id);
    try {
      await apiJson(`/api/studio/admin/users/${u.id}`, 'PATCH', {
        action: 'set-password',
        password: pwValue,
      });
      setLastCreated({ email: u.email ?? '', password: pwValue });
      setPwFor(null);
      setPwValue('');
      toast('success', `Nowe hasło dla ${u.email} ustawione.`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się zmienić hasła.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRename(u: AdminUserRow) {
    const newName = renameValue.trim();
    if (!newName) return setRenameFor(null);
    setBusyId(u.id);
    try {
      await apiJson(`/api/studio/admin/users/${u.id}`, 'PATCH', { action: 'rename', name: newName });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, display_name: newName } : x)));
      setRenameFor(null);
      toast('success', 'Nazwa zapisana.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się zmienić nazwy.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleAdmin(u: AdminUserRow) {
    setBusyId(u.id);
    try {
      await apiJson(`/api/studio/admin/users/${u.id}`, 'PATCH', {
        action: 'set-admin',
        value: !u.is_admin,
      });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_admin: !u.is_admin } : x)));
      toast('success', !u.is_admin ? `${u.email} jest teraz adminem.` : `Odebrano uprawnienia ${u.email}.`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Nie udało się zmienić uprawnień.');
    } finally {
      setBusyId(null);
    }
  }

  async function copyCredentials() {
    if (!lastCreated) return;
    try {
      await navigator.clipboard.writeText(
        `MyBed Visual Studio — https://studio-xi-two-14.vercel.app\nLogin: ${lastCreated.email}\nHasło: ${lastCreated.password}`
      );
      toast('success', 'Dane logowania skopiowane do schowka.');
    } catch {
      toast('error', 'Nie udało się skopiować do schowka.');
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (forbidden) {
    return (
      <div>
        <PageTitle title="Administracja" />
        <EmptyState
          icon={<Shield className="h-10 w-10" />}
          title="Brak uprawnień"
          hint="Ta sekcja jest dostępna tylko dla administratorów."
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <PageTitle
        title="Administracja"
        subtitle="Konta zespołu: dodawanie, hasła, uprawnienia."
      />

      {/* Nowe konto */}
      <Card className="mb-6 p-5">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-studio-muted">
          <UserPlus className="h-4 w-4" /> Dodaj osobę
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Imię / nazwa wyświetlana, np. Kasia"
            maxLength={120}
            className="rounded-xl border border-studio-border bg-studio-surface px-3 py-2.5 text-sm outline-none focus:border-studio-accent"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="adres@mybed.pl"
            className="rounded-xl border border-studio-border bg-studio-surface px-3 py-2.5 text-sm outline-none focus:border-studio-accent"
          />
          <div className="flex items-center gap-1.5">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Hasło (min. 8 znaków)"
              maxLength={72}
              className="w-full min-w-0 flex-1 rounded-xl border border-studio-border bg-studio-surface px-3 py-2.5 font-mono text-sm outline-none focus:border-studio-accent"
            />
            <Button
              variant="secondary"
              onClick={() => setPassword(generatePassword())}
              title="Wylosuj bezpieczne hasło"
              className="shrink-0 px-3"
            >
              <Dices className="h-4 w-4" />
            </Button>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={asAdmin}
              onChange={(e) => setAsAdmin(e.target.checked)}
              className="h-4 w-4 accent-studio-accent"
            />
            Uprawnienia administratora
          </label>
        </div>
        <div className="mt-4 flex items-center justify-end">
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? <Spinner className="h-4 w-4 text-white" /> : <UserPlus className="h-4 w-4" />}
            Utwórz konto
          </Button>
        </div>
        {lastCreated && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
            <p className="text-emerald-300 light:text-emerald-800">
              Dane logowania: <strong>{lastCreated.email}</strong> ·{' '}
              <code className="font-mono">{lastCreated.password}</code> — przekaż bezpiecznym
              kanałem i poproś o zmianę hasła.
            </p>
            <Button variant="secondary" onClick={copyCredentials} className="px-3 py-1.5 text-xs">
              <Copy className="h-3.5 w-3.5" /> Kopiuj
            </Button>
          </div>
        )}
      </Card>

      {/* Lista kont */}
      <Card className="divide-y divide-studio-border">
        {users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-studio-accent-soft text-sm font-semibold text-studio-accent-dark">
              {(u.display_name ?? u.email ?? '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              {renameFor === u.id ? (
                <div className="flex items-center gap-1.5">
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRename(u);
                      if (e.key === 'Escape') setRenameFor(null);
                    }}
                    maxLength={120}
                    autoFocus
                    className="w-40 rounded-lg border border-studio-border bg-studio-surface px-2 py-1 text-sm outline-none focus:border-studio-accent"
                  />
                  <button onClick={() => handleRename(u)} className="rounded-md p-1 text-emerald-400 light:text-emerald-600 hover:bg-studio-bg" aria-label="Zapisz">
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => setRenameFor(null)} className="rounded-md p-1 text-studio-muted hover:bg-studio-bg" aria-label="Anuluj">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {u.display_name ?? '—'}
                  <button
                    onClick={() => {
                      setRenameFor(u.id);
                      setRenameValue(u.display_name ?? '');
                    }}
                    className="rounded p-0.5 text-studio-muted opacity-60 transition-opacity hover:opacity-100"
                    title="Zmień nazwę wyświetlaną"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  {u.is_admin && <Badge tone="accent">admin</Badge>}
                  {u.id === me?.id && <Badge>to Ty</Badge>}
                </p>
              )}
              <p className="truncate text-xs text-studio-muted">
                {u.email} · ostatnie logowanie: {u.last_sign_in_at ? formatDate(u.last_sign_in_at) : 'nigdy'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {pwFor === u.id ? (
                <div className="flex items-center gap-1.5">
                  <input
                    value={pwValue}
                    onChange={(e) => setPwValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleSetPassword(u);
                      if (e.key === 'Escape') setPwFor(null);
                    }}
                    placeholder="Nowe hasło"
                    maxLength={72}
                    autoFocus
                    className="w-36 rounded-lg border border-studio-border bg-studio-surface px-2 py-1.5 font-mono text-xs outline-none focus:border-studio-accent"
                  />
                  <button
                    onClick={() => setPwValue(generatePassword())}
                    className="rounded-md p-1.5 text-studio-muted hover:bg-studio-bg"
                    title="Wylosuj hasło"
                  >
                    <Dices className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleSetPassword(u)}
                    disabled={busyId === u.id}
                    className="rounded-md p-1.5 text-emerald-400 light:text-emerald-600 hover:bg-studio-bg"
                    aria-label="Zapisz hasło"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => setPwFor(null)} className="rounded-md p-1.5 text-studio-muted hover:bg-studio-bg" aria-label="Anuluj">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setPwFor(u.id);
                      setPwValue(generatePassword());
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-studio-border px-2.5 py-1.5 text-xs text-studio-muted transition-colors hover:text-studio-ink"
                    title="Ustaw nowe hasło"
                  >
                    <KeyRound className="h-3.5 w-3.5" /> Hasło
                  </button>
                  <button
                    onClick={() => handleToggleAdmin(u)}
                    disabled={busyId === u.id || (u.id === me?.id && u.is_admin)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                      u.is_admin
                        ? 'border-studio-accent/50 bg-studio-accent-soft text-studio-accent-dark'
                        : 'border-studio-border text-studio-muted hover:text-studio-ink'
                    )}
                    title={
                      u.id === me?.id && u.is_admin
                        ? 'Nie możesz odebrać uprawnień samemu sobie'
                        : u.is_admin
                          ? 'Odbierz uprawnienia administratora'
                          : 'Nadaj uprawnienia administratora'
                    }
                  >
                    {u.is_admin ? <Shield className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
                    Admin
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </Card>
      <p className="mt-3 text-xs text-studio-muted">
        Konta są wspólne z dashboardem (ta sama baza logowania). Usuwanie kont celowo niedostępne
        z panelu — gdyby było potrzebne, zrób to w Supabase.
      </p>
    </div>
  );
}

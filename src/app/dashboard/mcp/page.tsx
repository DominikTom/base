'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChartCard } from '@/components/charts/chart-card';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';

interface TokenRow {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

interface UserRow {
  user_id: string;
  email: string;
  role: string;
  allowed_shops: string[] | null;
}

interface Payload {
  tokens: TokenRow[];
  me: { email: string; isAdmin: boolean; allowedShops: string[] };
  shops: string[];
  users?: UserRow[];
}

const EXPIRY = [
  { value: '90', label: '90 dni' },
  { value: '30', label: '30 dni' },
  { value: '365', label: '1 rok' },
  { value: '', label: 'Bez terminu' },
];

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function tokenStatus(t: TokenRow): { label: string; className: string } {
  if (t.revoked_at) return { label: 'Odwołany', className: 'text-ink-faint' };
  if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now()) return { label: 'Wygasł', className: 'text-ink-faint' };
  return { label: 'Aktywny', className: 'text-emerald-600' };
}

export default function McpAccessPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('90');
  const [saving, setSaving] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/user/mcp-tokens');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch('/api/user/mcp-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
  }

  async function handleCreate() {
    setSaving(true);
    try {
      const json = await post({ action: 'create', name, expires_days: expiry ? Number(expiry) : null });
      setNewToken(json.token);
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  }

  async function handleRevoke(id: string) {
    if (!window.confirm('Odwołać token? Klient MCP, który go używa, straci dostęp.')) return;
    try {
      await post({ action: 'revoke', id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleShops(user: UserRow, shops: string[] | null) {
    try {
      await post({ action: 'set_shops', user_id: user.user_id, allowed_shops: shops });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  const endpoint = `${origin}/api/mcp`;
  const tokenForSnippet = newToken || '<TWÓJ_TOKEN>';
  const claudeCode = `claude mcp add --transport http dash-mybed ${endpoint} --header "Authorization: Bearer ${tokenForSnippet}"`;
  const jsonConfig = JSON.stringify({
    mcpServers: { 'dash-mybed': { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${tokenForSnippet}` } } },
  }, null, 2);

  const inputClass = 'px-3 py-2 text-sm rounded-xl bg-surface border border-line text-ink placeholder:text-ink-faint focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <KeyRound size={20} className="text-ink-soft" />
        <h1 className="text-xl font-semibold tracking-tight text-ink">Dostęp MCP (Claude)</h1>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <ChartCard title="Serwer MCP dash.mybed" subtitle="Dane reklam Meta tylko do odczytu: wyniki, kreacje, zmęczenie, kampanie, materiały, stan danych">
        <div className="space-y-2 text-sm text-ink-soft">
          <div>Adres: <code className="font-mono text-ink break-all">{endpoint}</code></div>
          <div>Twój zakres sklepów: <span className="text-ink">{data?.me.allowedShops.join(', ') || '—'}</span></div>
          <div>Token działa jak hasło do danych reklam — nie wklejaj go do czatu ani do repozytorium.</div>
        </div>
      </ChartCard>

      <ChartCard title="Nowy token">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="stat-label">Nazwa</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="np. Claude Code — laptop" className={inputClass} maxLength={80} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="stat-label">Ważność</label>
            <select value={expiry} onChange={e => setExpiry(e.target.value)} className={inputClass}>
              {EXPIRY.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button onClick={handleCreate} disabled={saving || !name.trim()} className="btn-primary px-4 py-2 text-sm">
            <Plus size={16} />
            Wygeneruj
          </button>
        </div>

        {newToken && (
          <div className="mt-4 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="text-sm font-medium text-ink">Skopiuj token teraz — później zobaczysz tylko jego początek.</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs text-ink">{newToken}</code>
              <button onClick={() => copy(newToken, 'token')} className="btn-secondary px-3 py-2 text-sm"><Copy size={14} />{copied === 'token' ? 'Skopiowano' : 'Kopiuj'}</button>
            </div>
          </div>
        )}

        <div className="mt-4 space-y-3 text-sm">
          <div>
            <div className="stat-label mb-1">Claude Code</div>
            <div className="flex items-start gap-2">
              <code className="flex-1 break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs text-ink">{claudeCode}</code>
              <button onClick={() => copy(claudeCode, 'cc')} className="btn-secondary px-3 py-2 text-sm"><Copy size={14} />{copied === 'cc' ? 'Skopiowano' : 'Kopiuj'}</button>
            </div>
          </div>
          <div>
            <div className="stat-label mb-1">Inne klienty (konfiguracja JSON)</div>
            <pre className="overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-xs text-ink">{jsonConfig}</pre>
          </div>
        </div>
      </ChartCard>

      <ChartCard title="Moje tokeny">
        {!data ? (
          <div className="py-6 text-center text-ink-faint">Ładowanie...</div>
        ) : data.tokens.length === 0 ? (
          <div className="py-6 text-center text-ink-muted">Brak tokenów.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th className="px-3 py-2 text-left font-medium">Nazwa</th>
                  <th className="px-3 py-2 text-left font-medium">Token</th>
                  <th className="px-3 py-2 text-left font-medium">Utworzony</th>
                  <th className="px-3 py-2 text-left font-medium">Ostatnio użyty</th>
                  <th className="px-3 py-2 text-left font-medium">Wygasa</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="w-10 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.tokens.map(t => {
                  const status = tokenStatus(t);
                  return (
                    <tr key={t.id} className="border-b border-line/50">
                      <td className="px-3 py-2 text-ink">{t.name}</td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-soft">{t.token_prefix}…</td>
                      <td className="px-3 py-2 text-ink-soft">{fmt(t.created_at)}</td>
                      <td className="px-3 py-2 text-ink-soft">{fmt(t.last_used_at)}</td>
                      <td className="px-3 py-2 text-ink-soft">{t.expires_at ? fmt(t.expires_at) : 'bez terminu'}</td>
                      <td className={`px-3 py-2 ${status.className}`}>{status.label}</td>
                      <td className="px-3 py-2">
                        {status.label === 'Aktywny' && (
                          <button onClick={() => handleRevoke(t.id)} className="text-ink-faint hover:text-red-600" title="Odwołaj"><Trash2 size={14} /></button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      {data?.me.isAdmin && data.users && (
        <ChartCard title="Zakres sklepów użytkowników" subtitle="Dotyczy roli viewer. Admin zawsze widzi wszystkie sklepy.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th className="px-3 py-2 text-left font-medium">Użytkownik</th>
                  <th className="px-3 py-2 text-left font-medium">Rola</th>
                  <th className="px-3 py-2 text-left font-medium">Wszystkie</th>
                  {data.shops.map(s => <th key={s} className="px-3 py-2 text-left font-medium">{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.users.map(u => {
                  const all = u.allowed_shops == null;
                  const isAdminUser = u.role === 'admin';
                  return (
                    <tr key={u.user_id} className="border-b border-line/50">
                      <td className="px-3 py-2 text-ink">{u.email}</td>
                      <td className="px-3 py-2 text-ink-soft">{u.role}</td>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={all || isAdminUser} disabled={isAdminUser}
                          onChange={e => handleShops(u, e.target.checked ? null : [])} />
                      </td>
                      {data.shops.map(s => (
                        <td key={s} className="px-3 py-2">
                          <input type="checkbox" disabled={all || isAdminUser}
                            checked={all || isAdminUser || (u.allowed_shops || []).includes(s)}
                            onChange={e => {
                              const cur = new Set(u.allowed_shops || []);
                              if (e.target.checked) cur.add(s); else cur.delete(s);
                              handleShops(u, [...cur]);
                            }} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )}
    </div>
  );
}

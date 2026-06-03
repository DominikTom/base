'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChartCard } from '@/components/charts/chart-card';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { Plus, Trash2, DollarSign } from 'lucide-react';

interface AgencyCost {
  id: number;
  month: string;
  agency_name: string;
  service_type: string;
  amount_pln: number;
  notes: string | null;
  source_shop: string | null;
  platform: string | null;
}

const SHOPS = ['mybed.pl', 'mybed.de', 'mittohome.pl'];
const PLATFORMS = ['meta', 'google'];

export default function CostsPage() {
  const [costs, setCosts] = useState<AgencyCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [agency, setAgency] = useState('');
  const [service, setService] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [shop, setShop] = useState('');
  const [platform, setPlatform] = useState('');

  const fetchCosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/costs');
      const json = await res.json();
      setCosts(json.costs || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCosts(); }, [fetchCosts]);

  async function handleAdd() {
    if (!agency || !service || !amount) return;
    setSaving(true);
    try {
      const res = await fetch('/api/dashboard/costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          month: `${month}-01`,
          agency_name: agency,
          service_type: service,
          amount_pln: parseFloat(amount),
          notes: notes || null,
          source_shop: shop || null,
          platform: platform || null,
        }),
      });
      if (res.ok) {
        setAgency(''); setService(''); setAmount(''); setNotes(''); setShop(''); setPlatform('');
        fetchCosts();
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleDelete(id: number) {
    const res = await fetch('/api/dashboard/costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    if (res.ok) fetchCosts();
  }

  // Group by month
  const byMonth: Record<string, AgencyCost[]> = {};
  for (const c of costs) {
    const m = c.month.substring(0, 7);
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(c);
  }
  const months = Object.keys(byMonth).sort().reverse();
  const totalAll = costs.reduce((s, c) => s + c.amount_pln, 0);

  const inputClass = 'px-3 py-2 text-sm rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Koszty marketingu — Agencje</h1>
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <DollarSign size={16} />
          Total: <span className="text-zinc-200 font-medium">{formatCurrency(totalAll)}</span>
        </div>
      </div>

      {/* Add cost form */}
      <ChartCard title="Dodaj koszt">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Miesiąc</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Agencja</label>
            <input type="text" value={agency} onChange={e => setAgency(e.target.value)} placeholder="np. Gogini" className={inputClass} list="agencies" />
            <datalist id="agencies">
              {[...new Set(costs.map(c => c.agency_name))].map(a => <option key={a} value={a} />)}
            </datalist>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Usługa</label>
            <input type="text" value={service} onChange={e => setService(e.target.value)} placeholder="np. Google Ads" className={inputClass} list="services" />
            <datalist id="services">
              {[...new Set(costs.map(c => c.service_type))].map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Kwota (PLN)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="10000" className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Sklep</label>
            <select value={shop} onChange={e => setShop(e.target.value)} className={inputClass}>
              <option value="">Ogólne</option>
              {SHOPS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Platforma</label>
            <select value={platform} onChange={e => setPlatform(e.target.value)} className={inputClass}>
              <option value="">Inne</option>
              {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Notatka</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="opcjonalnie" className={inputClass} />
          </div>
          <button
            onClick={handleAdd}
            disabled={saving || !agency || !service || !amount}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Plus size={16} />
            Dodaj
          </button>
        </div>
      </ChartCard>

      {/* Costs by month */}
      {loading ? (
        <div className="text-zinc-500 text-center py-8">Ładowanie...</div>
      ) : months.length === 0 ? (
        <div className="text-zinc-500 text-center py-8">Brak kosztów. Dodaj pierwszy koszt powyżej.</div>
      ) : (
        months.map(m => {
          const items = byMonth[m];
          const monthTotal = items.reduce((s, c) => s + c.amount_pln, 0);
          return (
            <ChartCard key={m} title={m} subtitle={`Total: ${formatCurrency(monthTotal)}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-400">
                      <th className="px-3 py-2 text-left font-medium">Agencja</th>
                      <th className="px-3 py-2 text-left font-medium">Usługa</th>
                      <th className="px-3 py-2 text-left font-medium">Sklep</th>
                      <th className="px-3 py-2 text-left font-medium">Platforma</th>
                      <th className="px-3 py-2 text-right font-medium">Kwota</th>
                      <th className="px-3 py-2 text-left font-medium">Notatka</th>
                      <th className="px-3 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(c => (
                      <tr key={c.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30">
                        <td className="px-3 py-2 text-zinc-300">{c.agency_name}</td>
                        <td className="px-3 py-2 text-zinc-400">{c.service_type}</td>
                        <td className="px-3 py-2 text-zinc-400 text-xs">{c.source_shop || '—'}</td>
                        <td className="px-3 py-2 text-zinc-400 text-xs">{c.platform || '—'}</td>
                        <td className="px-3 py-2 text-right text-zinc-200">{formatCurrency(c.amount_pln)}</td>
                        <td className="px-3 py-2 text-zinc-500 text-xs">{c.notes || '—'}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => handleDelete(c.id)} className="text-zinc-600 hover:text-red-400">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          );
        })
      )}
    </div>
  );
}

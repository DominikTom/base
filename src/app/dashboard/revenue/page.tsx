'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { ChartCard } from '@/components/charts/chart-card';
import { RevenueChart } from '@/components/charts/revenue-chart';
import { SimpleBarChart } from '@/components/charts/bar-chart';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatCurrency, formatNumber } from '@/lib/utils';

interface RevenueData {
  revenueByShopTimeSeries: Array<Record<string, string | number>>;
  shops: string[];
  supplierRanking: Array<{ name: string; value: number }>;
  statusFunnel: Record<string, number>;
  paymentRate: number;
  aovTrend: Array<{ name: string; value: number }>;
  couponAnalysis: Array<{ code: string; count: number; revenue: number }>;
}

export default function RevenuePage() {
  const { filters } = useDashboard();
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState('day');

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          date_from: filters.dateFrom,
          date_to: filters.dateTo,
          shop: filters.shop,
          granularity,
        });
        const res = await fetch(`/api/dashboard/revenue?${params}`);
        const json = await res.json();
        setData(json);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters, granularity]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-pulse text-zinc-500">Ładowanie danych...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <p className="text-zinc-500">Brak danych. Zaimportuj CSV w zakładce ETL Admin.</p>
      </div>
    );
  }

  const statusData = Object.entries(data.statusFunnel)
    .sort(([, a], [, b]) => b - a)
    .map(([name, value]) => ({ name, value }));

  const couponColumns: Column<{ code: string; count: number; revenue: number }>[] = [
    { key: 'code', header: 'Kupon', accessor: r => r.code },
    { key: 'count', header: 'Zamówienia', accessor: r => r.count, align: 'right' },
    { key: 'revenue', header: 'Revenue', accessor: r => r.revenue, align: 'right', format: v => formatCurrency(v as number) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Revenue & Zamówienia</h1>
        <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-1">
          {(['day', 'week', 'month', 'quarter'] as const).map(g => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                granularity === g
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {g === 'day' ? 'Dzień' : g === 'week' ? 'Tydzień' : g === 'month' ? 'Miesiąc' : 'Kwartał'}
            </button>
          ))}
        </div>
      </div>

      {/* Revenue per shop stacked */}
      <ChartCard title="Revenue wg sklepu w czasie" subtitle="Stacked area">
        <RevenueChart data={data.revenueByShopTimeSeries} shops={data.shops} stacked />
      </ChartCard>

      {/* Status funnel + AOV trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Status zamówień" subtitle={`Wskaźnik płatności: ${data.paymentRate}%`}>
          <SimpleBarChart data={statusData} barColor="#8b5cf6" />
        </ChartCard>
        <ChartCard title="Trend AOV">
          <SimpleBarChart
            data={data.aovTrend}
            barColor="#10b981"
            valueFormatter={v => formatCurrency(v)}
          />
        </ChartCard>
      </div>

      {/* Supplier ranking */}
      <ChartCard title="Revenue wg dostawcy">
        <SimpleBarChart
          data={data.supplierRanking.slice(0, 15)}
          layout="horizontal"
          height={400}
          barColor="#f59e0b"
          valueFormatter={v => formatCurrency(v)}
        />
      </ChartCard>

      {/* Coupon analysis */}
      <ChartCard title="Analiza kuponów">
        <DataTable data={data.couponAnalysis} columns={couponColumns} pageSize={10} />
      </ChartCard>
    </div>
  );
}

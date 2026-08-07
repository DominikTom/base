'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { KpiCard } from '@/components/ui/kpi-card';
import { ChartCard } from '@/components/charts/chart-card';
import { RevenueChart } from '@/components/charts/revenue-chart';
import { SimpleBarChart } from '@/components/charts/bar-chart';
import { SimplePieChart } from '@/components/charts/pie-chart';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { previousPeriod, pctChange, COMPARE_LABEL } from '@/lib/period-compare';
import { DollarSign, ShoppingCart, TrendingUp, Truck } from 'lucide-react';

interface OverviewData {
  kpis: {
    revenue: number;
    orders: number;
    ordersPaid: number;
    ordersCancelled: number;
    aov: number;
    shipping: number;
  };
  sparklines: {
    revenue: number[];
    orders: number[];
  };
  charts: {
    revenueByShop: Array<{ name: string; value: number }>;
    revenueTimeSeries: Array<Record<string, string | number>>;
    ordersTimeSeries: Array<{ name: string; value: number }>;
    topProducts: Array<{ name: string; value: number; category: string }>;
    categoryBreakdown: Array<{ name: string; value: number }>;
  };
  shops: string[];
}

export default function OverviewPage() {
  const { filters } = useDashboard();
  const [data, setData] = useState<OverviewData | null>(null);
  const [prevKpis, setPrevKpis] = useState<OverviewData['kpis'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const prev = previousPeriod(filters.dateFrom, filters.dateTo);
        // Dwa fetche równolegle — current i previous okres tej samej długości.
        const [curRes, prevRes] = await Promise.all([
          fetch(`/api/dashboard/overview?${new URLSearchParams({ date_from: filters.dateFrom, date_to: filters.dateTo, shop: filters.shop })}`),
          fetch(`/api/dashboard/overview?${new URLSearchParams({ date_from: prev.from, date_to: prev.to, shop: filters.shop })}`),
        ]);
        if (!curRes.ok) throw new Error(`HTTP ${curRes.status}`);
        const curJson: OverviewData = await curRes.json();
        const prevJson: OverviewData | null = prevRes.ok ? await prevRes.json() : null;
        setData(curJson);
        setPrevKpis(prevJson?.kpis ?? null);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-pulse text-ink-faint">Ładowanie danych...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <div className="text-red-600">Błąd ładowania danych</div>
        <div className="text-sm text-ink-muted">{error}</div>
        <p className="text-sm text-ink-faint">Upewnij się, że zaimportowałeś dane CSV w zakładce ETL Admin.</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Przegląd</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Revenue (brutto)"
          value={formatCurrency(data.kpis.revenue)}
          icon={<DollarSign size={18} />}
          sparkline={data.sparklines.revenue}
          change={pctChange(data.kpis.revenue, prevKpis?.revenue)}
          changeLabel={COMPARE_LABEL}
        />
        <KpiCard
          title="Zamówienia"
          value={formatNumber(data.kpis.orders)}
          icon={<ShoppingCart size={18} />}
          sparkline={data.sparklines.orders}
          change={pctChange(data.kpis.orders, prevKpis?.orders)}
          changeLabel={COMPARE_LABEL}
        />
        <KpiCard
          title="AOV"
          value={formatCurrency(data.kpis.aov)}
          icon={<TrendingUp size={18} />}
          change={pctChange(data.kpis.aov, prevKpis?.aov)}
          changeLabel={COMPARE_LABEL}
        />
        <KpiCard
          title="Opłacone / Anulowane"
          value={`${formatNumber(data.kpis.ordersPaid)} / ${formatNumber(data.kpis.ordersCancelled)}`}
          icon={<Truck size={18} />}
          changeLabel={`${data.kpis.orders > 0 ? ((data.kpis.ordersPaid / data.kpis.orders) * 100).toFixed(0) : 0}% opłaconych`}
        />
      </div>

      {/* Revenue over time + Revenue by shop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Revenue w czasie" subtitle="Podział na sklepy" className="lg:col-span-2">
          <RevenueChart data={data.charts.revenueTimeSeries} shops={data.shops} stacked />
        </ChartCard>
        <ChartCard title="Revenue wg sklepu">
          <SimplePieChart data={data.charts.revenueByShop} colorMap="shop" />
        </ChartCard>
      </div>

      {/* Orders + Top Products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Zamówienia dziennie">
          <SimpleBarChart data={data.charts.ordersTimeSeries} />
        </ChartCard>
        <ChartCard title="Top 10 produktów (wg ilości)">
          <SimpleBarChart data={data.charts.topProducts} layout="horizontal" colorByName />
        </ChartCard>
      </div>

      {/* Category breakdown */}
      <ChartCard title="Kategorie produktów (wg ilości)">
        <SimpleBarChart data={data.charts.categoryBreakdown} colorByName height={280} />
      </ChartCard>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { ChartCard } from '@/components/charts/chart-card';
import { SimpleBarChart } from '@/components/charts/bar-chart';
import { SimplePieChart } from '@/components/charts/pie-chart';
import { KpiCard } from '@/components/ui/kpi-card';
import { formatNumber } from '@/lib/utils';
import { Package } from 'lucide-react';

interface ProductsData {
  topByQuantity: Array<{ name: string; value: number; orderCount: number; category: string }>;
  topByOrders: Array<{ name: string; value: number; quantity: number; category: string }>;
  fabricChart: Array<{ name: string; value: number }>;
  sizeChart: Array<{ name: string; value: number }>;
  mattressChart: Array<{ name: string; value: number }>;
  headboardChart: Array<{ name: string; value: number }>;
  categoryChart: Array<{ name: string; value: number }>;
  totalProducts: number;
}

export default function ProductsPage() {
  const { filters } = useDashboard();
  const [data, setData] = useState<ProductsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          date_from: filters.dateFrom,
          date_to: filters.dateTo,
          shop: filters.shop,
        });
        const res = await fetch(`/api/dashboard/products?${params}`);
        const json = await res.json();
        setData(json);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-pulse text-muted">Ładowanie danych...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <p className="text-muted">Brak danych produktowych.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-fg">Analityka Produktów</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          title="Unikalne produkty"
          value={formatNumber(data.totalProducts)}
          icon={<Package size={18} />}
        />
        <KpiCard
          title="Top produkt (wg ilości)"
          value={data.topByQuantity[0]?.name || '-'}
          changeLabel={`${formatNumber(data.topByQuantity[0]?.value || 0)} szt.`}
        />
        <KpiCard
          title="Top kolekcja tkanin"
          value={data.fabricChart[0]?.name || '-'}
          changeLabel={`${formatNumber(data.fabricChart[0]?.value || 0)} szt.`}
        />
      </div>

      {/* Top products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Top 20 produktów wg ilości">
          <SimpleBarChart data={data.topByQuantity} layout="horizontal" height={500} barColor="#9333EA" />
        </ChartCard>
        <ChartCard title="Top 20 produktów wg zamówień">
          <SimpleBarChart data={data.topByOrders} layout="horizontal" height={500} barColor="#8b5cf6" />
        </ChartCard>
      </div>

      {/* Category breakdown */}
      <ChartCard title="Kategorie produktów">
        <SimplePieChart data={data.categoryChart} colorMap="category" height={350} />
      </ChartCard>

      {/* Fabric + Size */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Popularność kolekcji tkanin (Top 10)">
          <SimplePieChart data={data.fabricChart} height={320} />
        </ChartCard>
        <ChartCard title="Rozkład rozmiarów łóżek">
          <SimpleBarChart data={data.sizeChart} barColor="#16A34A" />
        </ChartCard>
      </div>

      {/* Mattress + Headboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Typ materaca">
          <SimpleBarChart data={data.mattressChart} barColor="#9333EA" />
        </ChartCard>
        <ChartCard title="Wysokość wezgłowia">
          <SimpleBarChart data={data.headboardChart} barColor="#ec4899" />
        </ChartCard>
      </div>
    </div>
  );
}

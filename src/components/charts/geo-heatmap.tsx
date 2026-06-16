'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap, CircleMarker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import 'leaflet/dist/leaflet.css';
import { formatCurrency, formatNumber } from '@/lib/utils';

// Heatmapa sprzedaży po miastach (PL + DE). Renderuje:
//   - tile layer OpenStreetMap (bez kluczy)
//   - heat layer z gradientem ciepła (intensywność = wybrana metryka)
//   - markery click-to-popup z liczbami konkretnego miasta
//
// User przełącza metrykę "Zamówienia" / "Revenue" w toolbarze — zmiana
// triggeruje re-render heat layer'a z innymi wagami.

export interface GeoPoint {
  name: string;
  country: string;
  lat: number;
  lon: number;
  orders: number;
  revenue: number;
}

interface Props {
  data: GeoPoint[];
  stats?: { matched: number; unmatched: number; coverage: number };
}

type Metric = 'orders' | 'revenue';

// Wewnętrzny komponent — działa w kontekście MapContainer i ma dostęp do mapy.
// leaflet.heat to imperatywny pluginem — managuje przez useEffect.
function HeatLayer({ points, metric }: { points: GeoPoint[]; metric: Metric }) {
  const map = useMap();
  const layerRef = useRef<L.Layer | null>(null);

  useEffect(() => {
    if (!points.length) return;
    // Normalizacja: max value = 1.0, pozostałe proporcjonalnie.
    const max = Math.max(...points.map(p => p[metric]), 1);
    const heatPoints: [number, number, number][] = points.map(p => [
      p.lat,
      p.lon,
      Math.max(0.05, p[metric] / max),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer = (L as any).heatLayer(heatPoints, {
      radius: 28,
      blur: 22,
      maxZoom: 11,
      max: 1.0,
      gradient: {
        0.0: '#3B82F6',  // niebieski (cold)
        0.3: '#10B981',  // zielony
        0.55: '#FACC15', // żółty
        0.75: '#F97316', // pomarańczowy
        1.0: '#DC2626',  // czerwony (hot)
      },
    });
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
      layerRef.current = null;
    };
  }, [map, points, metric]);

  return null;
}

// Auto-fit do bounding box danych po pierwszym renderze (i przy zmianie danych).
function FitToData({ points }: { points: GeoPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lon] as [number, number]));
    map.fitBounds(bounds.pad(0.15), { animate: false });
  }, [map, points]);
  return null;
}

export function GeoHeatmap({ data, stats }: Props) {
  const [metric, setMetric] = useState<Metric>('orders');

  // Top 20 markerów do kliknięcia (nie dodajemy markera per każdy punkt — heatmapa
  // już wizualizuje rozkład; markery są tylko żeby user mógł sprawdzić konkretne
  // liczby dla największych miast).
  const topMarkers = useMemo(() => {
    return [...data]
      .sort((a, b) => b[metric] - a[metric])
      .slice(0, 25);
  }, [data, metric]);

  const totals = useMemo(() => {
    return {
      cities: data.length,
      orders: data.reduce((s, p) => s + p.orders, 0),
      revenue: data.reduce((s, p) => s + p.revenue, 0),
    };
  }, [data]);

  if (!data.length) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted">
        Brak danych geograficznych w wybranym okresie.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap shrink-0">
        <div className="inline-flex rounded-pill border border-line bg-bg p-0.5">
          {(['orders', 'revenue'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-3 py-1 text-[11px] font-medium rounded-pill transition-colors ${
                metric === m ? 'bg-primary-600 text-white' : 'text-fg-soft hover:text-fg'
              }`}
            >
              {m === 'orders' ? 'Zamówienia' : 'Revenue'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted">
          <span><b className="text-fg-soft">{formatNumber(totals.cities)}</b> miast</span>
          <span><b className="text-fg-soft">{formatNumber(totals.orders)}</b> zam.</span>
          <span><b className="text-fg-soft">{formatCurrency(totals.revenue, 'PLN')}</b></span>
          {stats && <span title={`Dopasowane: ${stats.matched} / niedopasowane: ${stats.unmatched}`}>pokrycie {stats.coverage}%</span>}
        </div>
      </div>

      {/* Mapa */}
      <div className="flex-1 min-h-0 rounded-card overflow-hidden border border-line">
        <MapContainer
          center={[52.0, 16.0]}
          zoom={6}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <HeatLayer points={data} metric={metric} />
          <FitToData points={data} />
          {topMarkers.map(p => (
            <CircleMarker
              key={`${p.name}-${p.country}`}
              center={[p.lat, p.lon]}
              radius={3}
              pathOptions={{ color: '#1f2937', fillColor: '#1f2937', fillOpacity: 0.5, weight: 1 }}
            >
              <Popup>
                <div className="text-xs">
                  <div className="font-semibold">{p.name} <span className="text-muted">({p.country})</span></div>
                  <div className="mt-1">Zamówienia: <b>{formatNumber(p.orders)}</b></div>
                  <div>Revenue: <b>{formatCurrency(p.revenue, 'PLN')}</b></div>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

export default GeoHeatmap;

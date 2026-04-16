export interface WidgetInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}

export interface DashboardLayout {
  id: string;
  name: string;
  widgets: WidgetInstance[];
  updatedAt: string;
}

const STORAGE_KEY = 'mybed_dashboard_layouts';
const ACTIVE_KEY = 'mybed_active_dashboard';

export function loadLayouts(): DashboardLayout[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLayouts(layouts: DashboardLayout[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
}

export function getActiveLayoutId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveLayoutId(id: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACTIVE_KEY, id);
}

export function getOrCreateDefaultLayout(): DashboardLayout {
  const layouts = loadLayouts();
  if (layouts.length > 0) {
    const activeId = getActiveLayoutId();
    const active = layouts.find(l => l.id === activeId);
    return active || layouts[0];
  }

  const defaultLayout: DashboardLayout = {
    id: 'default',
    name: 'Mój Dashboard',
    widgets: [
      { id: 'w1', type: 'kpi_revenue', x: 0, y: 0, w: 3, h: 2 },
      { id: 'w2', type: 'kpi_orders', x: 3, y: 0, w: 3, h: 2 },
      { id: 'w3', type: 'kpi_aov', x: 6, y: 0, w: 3, h: 2 },
      { id: 'w4', type: 'kpi_payment_rate', x: 9, y: 0, w: 3, h: 2 },
      { id: 'w5', type: 'chart_revenue_timeline', x: 0, y: 2, w: 8, h: 5 },
      { id: 'w6', type: 'chart_payment_status', x: 8, y: 2, w: 4, h: 5 },
      { id: 'w7', type: 'ranking_models', x: 0, y: 7, w: 6, h: 5 },
      { id: 'w8', type: 'ranking_fabric_collections', x: 6, y: 7, w: 6, h: 5 },
    ],
    updatedAt: new Date().toISOString(),
  };

  saveLayouts([defaultLayout]);
  setActiveLayoutId('default');
  return defaultLayout;
}

export function generateWidgetId(): string {
  return 'w_' + Math.random().toString(36).substring(2, 9);
}

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

export interface DashboardData {
  layouts: DashboardLayout[];
  defaultLayoutId: string;
}

export function createDefaultLayout(): DashboardLayout {
  return {
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
}

export function createDefaultDashboardData(): DashboardData {
  const layout = createDefaultLayout();
  return { layouts: [layout], defaultLayoutId: layout.id };
}

export function generateWidgetId(): string {
  return 'w_' + Math.random().toString(36).substring(2, 9);
}

export function generateLayoutId(): string {
  return 'l_' + Math.random().toString(36).substring(2, 9);
}

// Migrate old single-layout format to new multi-layout format
export function migrateToMultiLayout(old: unknown): DashboardData {
  if (!old || typeof old !== 'object') return createDefaultDashboardData();

  const obj = old as Record<string, unknown>;

  // Already new format
  if (Array.isArray(obj.layouts)) return old as DashboardData;

  // Old format: single layout with widgets array
  if (Array.isArray(obj.widgets)) {
    const layout = old as DashboardLayout;
    if (!layout.id) layout.id = 'default';
    if (!layout.name) layout.name = 'Mój Dashboard';
    return { layouts: [layout], defaultLayoutId: layout.id };
  }

  return createDefaultDashboardData();
}

// Legacy exports for backward compatibility
export function getOrCreateDefaultLayout(): DashboardLayout {
  return createDefaultLayout();
}

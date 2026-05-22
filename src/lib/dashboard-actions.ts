import { getWidgetDef } from './widget-definitions';
import {
  migrateToMultiLayout,
  createDefaultDashboardData,
  generateWidgetId,
  type WidgetInstance,
  type DashboardData,
} from './dashboard-store';
import type { QuerySpec } from './explorer-whitelist';

// Buduje instancję widgetu custom_explorer z nazwy + specyfikacji zapytania
// (np. z definicji KPI). Widget renderuje widget-renderer przez /api/dashboard/explorer.
export function buildCustomWidget(title: string, querySpec: QuerySpec): WidgetInstance {
  const def = getWidgetDef('custom_explorer');
  return {
    id: generateWidgetId(),
    type: 'custom_explorer',
    x: 0,
    y: Infinity,
    w: def?.defaultSize.w ?? 8,
    h: def?.defaultSize.h ?? 5,
    config: { title, ...querySpec },
  };
}

// Ładuje dashboard zalogowanego użytkownika, dokłada widget do domyślnego
// układu i zapisuje. Używane przez stronę KPI ("Dodaj do dashboardu").
export async function addCustomWidgetToDashboard(
  title: string,
  querySpec: QuerySpec,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const profileRes = await fetch('/api/user');
    const profileJson = profileRes.ok ? await profileRes.json() : null;
    const raw = profileJson?.profile?.dashboard_layout;
    const dashData: DashboardData = raw ? migrateToMultiLayout(raw) : createDefaultDashboardData();
    const layout = dashData.layouts.find(l => l.id === dashData.defaultLayoutId) || dashData.layouts[0];
    if (!layout) return { ok: false, error: 'Brak układu dashboardu' };

    layout.widgets = [...layout.widgets, buildCustomWidget(title, querySpec)];
    layout.updatedAt = new Date().toISOString();

    const res = await fetch('/api/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_dashboard_data', data: dashData }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, error: j.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

import { getWidgetDef } from './widget-definitions';
import {
  migrateToMultiLayout,
  createDefaultDashboardData,
  generateWidgetId,
  type WidgetInstance,
  type DashboardData,
} from './dashboard-store';

// Buduje instancję dowolnego widgetu (predefiniowanego lub custom_explorer).
export function buildWidget(type: string, config?: Record<string, unknown>): WidgetInstance {
  const def = getWidgetDef(type);
  return {
    id: generateWidgetId(),
    type,
    x: 0,
    y: Infinity,
    w: def?.defaultSize.w ?? 6,
    h: def?.defaultSize.h ?? 4,
    config,
  };
}

// Ładuje dashboard zalogowanego użytkownika, dokłada widget do domyślnego
// układu i zapisuje. Używane przez stronę KPI ("Dodaj do dashboardu") oraz
// czat ("Zapisz / dodaj na dashboard"). Config jest KOPIOWANY — późniejsza
// edycja KPI nie zmienia już dodanych widgetów.
export async function addWidgetToDashboard(
  type: string,
  config?: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const profileRes = await fetch('/api/user');
    const profileJson = profileRes.ok ? await profileRes.json() : null;
    const raw = profileJson?.profile?.dashboard_layout;
    const dashData: DashboardData = raw ? migrateToMultiLayout(raw) : createDefaultDashboardData();
    const layout = dashData.layouts.find(l => l.id === dashData.defaultLayoutId) || dashData.layouts[0];
    if (!layout) return { ok: false, error: 'Brak układu dashboardu' };

    layout.widgets = [...layout.widgets, buildWidget(type, config)];
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

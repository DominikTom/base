import type Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase';
import { runAiQuery } from '@/lib/ai-db';
import { validateQuerySpec, type QuerySpec } from '@/lib/explorer-whitelist';
import { getWidgetDef } from '@/lib/widget-definitions';
import {
  migrateToMultiLayout,
  createDefaultDashboardData,
  generateWidgetId,
  type DashboardData,
  type WidgetInstance,
} from '@/lib/dashboard-store';
import { DB_SCHEMA_DESCRIPTION, WIDGET_SPEC_REFERENCE } from './schema-context';
import type { Artifact, AssistantStep } from './types';

export interface ToolContext {
  userId: string;
  userEmail: string;
  isAdmin: boolean;
}

export interface ToolOutcome {
  content: string;          // treść tool_result wracająca do modelu
  artifact?: Artifact;      // opcjonalny artefakt do wyświetlenia w UI
  step?: AssistantStep;     // krok do popupu "Jak to policzono"
}

// Ile wierszy wyniku SQL przekazać modelowi.
const MODEL_ROW_CAP = 100;

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'get_schema',
    description:
      'Zwraca opis modelu danych (tabele, kolumny, relacje) oraz specyfikację configów widgetów/KPI. Wywołaj, jeśli potrzebujesz przypomnieć sobie strukturę bazy.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'run_sql',
    description:
      'Wykonuje zapytanie SQL tylko do odczytu (SELECT / WITH...SELECT) na bazie analitycznej i zwraca wiersze. Jedna instrukcja, wynik ograniczony do 1000 wierszy, limit czasu 8s. Agreguj dane w SQL. Jeśli zapytanie zwróci błąd, popraw je i spróbuj ponownie.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Zapytanie SELECT do wykonania.' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'show_chart',
    description:
      'Wyświetla wykres LUB tabelę w czacie jako kartę artefaktu (z przyciskiem „Zapisz jako KPI"). Przekaż MAŁY, już zagregowany zbiór danych (najlepiej < 100 punktów / wierszy). Jeśli artefakt odpowiada standardowemu zapytaniu (oś data/sklep/kategoria/dostawca/platforma × metryka revenue/orders/aov/quantity), dołącz query_spec — wtedy użytkownik może go zapisać jako KPI. Dla tabel: chart_type="table", series = kolumny wartości, x_key = kolumna etykiet (pierwsza), data = wiersze.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        chart_type: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'table'] },
        x_key: { type: 'string', description: 'Nazwa klucza w obiektach data dla osi X / etykiet.' },
        series: {
          type: 'array',
          items: { type: 'string' },
          description: 'Nazwy kluczy danych będących seriami (wartościami).',
        },
        data: {
          type: 'array',
          items: { type: 'object' },
          description: 'Tablica obiektów, każdy z x_key oraz kluczami z series.',
        },
        query_spec: {
          type: 'object',
          description: 'Opcjonalnie: config umożliwiający zapis wykresu jako KPI. Filtry (np. sklep) wpisz w filters_advanced.',
          properties: {
            x_axis: { type: 'string' },
            y_axis: { type: 'string' },
            group_by: { type: 'string' },
            granularity: { type: 'string', enum: ['day', 'week', 'month', 'quarter'] },
            filters_advanced: { type: 'array', items: { type: 'object' } },
          },
        },
      },
      required: ['title', 'chart_type', 'x_key', 'series', 'data'],
    },
  },
  {
    name: 'create_widget',
    description:
      'Dodaje widget na dashboardzie użytkownika ("Mój Dashboard"). Wywołuj tylko, gdy użytkownik wprost prosi o dodanie/zapisanie widgetu.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        chart_type: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'table'] },
        x_axis: { type: 'string', enum: ['date', 'source_shop', 'source_platform', 'supplier', 'delivery_city', 'status', 'coupon_code', 'product_category', 'fabric_collection', 'bed_size', 'mattress_type', 'headboard_height'] },
        y_axis: { type: 'string', enum: ['revenue_gross', 'revenue_paid', 'shipping_revenue', 'orders_count', 'orders_paid', 'orders_cancelled', 'avg_order_value', 'quantity', 'meta_spend', 'meta_impressions', 'meta_clicks', 'meta_conversions', 'meta_ctr', 'meta_cpc', 'google_spend', 'sessions', 'users', 'transactions', 'ga_revenue', 'pageviews'] },
        group_by: { type: 'string', enum: ['', 'source_shop', 'source_platform', 'supplier', 'status', 'delivery_city', 'product_category', 'fabric_collection', 'bed_size', 'mattress_type', 'headboard_height'] },
        granularity: { type: 'string', enum: ['day', 'week', 'month', 'quarter'] },
        filters_advanced: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              operator: { type: 'string' },
              value: { type: 'string' },
              value_to: { type: 'string' },
            },
            required: ['field', 'operator'],
          },
        },
      },
      required: ['title', 'chart_type', 'x_axis', 'y_axis', 'granularity'],
    },
  },
  {
    name: 'create_kpi',
    description:
      'Dodaje definicję KPI do wspólnego rejestru KPI. Tylko administratorzy. Wywołuj tylko, gdy użytkownik wprost prosi o zapisanie KPI.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', description: 'np. Sprzedaż, Marketing, Produkty, Operacje' },
        tier: { type: 'string', enum: ['core', 'standard', 'experimental'] },
        value_type: { type: 'string', enum: ['currency', 'number', 'percent', 'ratio'] },
        query_spec: {
          type: 'object',
          properties: {
            chart_type: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'table'] },
            x_axis: { type: 'string' },
            y_axis: { type: 'string' },
            group_by: { type: 'string' },
            granularity: { type: 'string', enum: ['day', 'week', 'month', 'quarter'] },
            filters_advanced: { type: 'array', items: { type: 'object' } },
          },
          required: ['chart_type', 'x_axis', 'y_axis', 'granularity'],
        },
      },
      required: ['name', 'category', 'tier', 'value_type', 'query_spec'],
    },
    // Cache całej tablicy narzędzi — definicje są stałe między żądaniami.
    cache_control: { type: 'ephemeral' },
  },
];

function err(message: string): ToolOutcome {
  return { content: JSON.stringify({ error: message }), artifact: { type: 'error', message } };
}

async function loadDashboardData(userId: string): Promise<DashboardData> {
  const { data } = await getSupabaseAdmin()
    .from('user_profiles')
    .select('dashboard_layout')
    .eq('user_id', userId)
    .single();
  return data?.dashboard_layout
    ? migrateToMultiLayout(data.dashboard_layout)
    : createDefaultDashboardData();
}

async function handleRunSql(input: Record<string, unknown>): Promise<ToolOutcome> {
  const sql = typeof input.sql === 'string' ? input.sql : '';
  const result = await runAiQuery(input.sql);
  if (result.error) {
    return {
      content: JSON.stringify({ error: result.error }),
      step: { kind: 'sql', sql, error: result.error },
    };
  }
  // Wynik trafia do modelu jako dane — bez artefaktu. Model prezentuje
  // odpowiedź sam (tabela Markdown / wykres). Zapytania widoczne są
  // w popupie "Jak to policzono".
  const modelRows = result.rows.slice(0, MODEL_ROW_CAP);
  const content = JSON.stringify({
    columns: result.columns,
    rowCount: result.rowCount,
    truncated: result.truncated,
    showing: modelRows.length,
    rows: modelRows,
  });
  return {
    content,
    step: { kind: 'sql', sql, rowCount: result.rowCount },
  };
}

function handleShowChart(input: Record<string, unknown>): ToolOutcome {
  const chartType = String(input.chart_type);
  if (!['bar', 'line', 'area', 'pie', 'table'].includes(chartType)) {
    return err(`Niedozwolony chart_type: ${chartType}`);
  }
  const data = Array.isArray(input.data) ? (input.data as Record<string, unknown>[]) : [];
  const series = Array.isArray(input.series) ? input.series.map(String) : [];
  if (!data.length || !series.length) {
    return err('show_chart wymaga niepustych pól data i series.');
  }
  const title = String(input.title || 'Wykres');

  // Opcjonalny query_spec — gdy poprawny, pozwala zapisać wykres jako KPI.
  let querySpec: QuerySpec | undefined;
  if (input.query_spec && typeof input.query_spec === 'object') {
    const raw = input.query_spec as Record<string, unknown>;
    const candidate: QuerySpec = {
      chart_type: chartType,
      x_axis: String(raw.x_axis || 'date'),
      y_axis: String(raw.y_axis || 'revenue_gross'),
      group_by: raw.group_by ? String(raw.group_by) : '',
      granularity: String(raw.granularity || 'month'),
      filters_advanced: Array.isArray(raw.filters_advanced) ? raw.filters_advanced : [],
    };
    if (validateQuerySpec(candidate).length === 0) querySpec = candidate;
  }

  return {
    content: JSON.stringify({ ok: true, points: data.length }),
    artifact: {
      type: 'chart',
      title,
      chart_type: chartType as 'bar' | 'line' | 'area' | 'pie' | 'table',
      x_key: String(input.x_key || 'x'),
      series,
      data: data.slice(0, 500),
      query_spec: querySpec,
    },
    step: { kind: 'chart', label: title },
  };
}

async function handleCreateWidget(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const spec = {
    chart_type: String(input.chart_type || 'bar'),
    x_axis: String(input.x_axis || 'date'),
    y_axis: String(input.y_axis || 'revenue_gross'),
    group_by: input.group_by ? String(input.group_by) : '',
    granularity: String(input.granularity || 'month'),
    filters_advanced: Array.isArray(input.filters_advanced) ? input.filters_advanced : [],
  } as QuerySpec;

  const errors = validateQuerySpec(spec);
  if (errors.length) return err(`Niepoprawna konfiguracja widgetu: ${errors.join('; ')}`);

  const dashData = await loadDashboardData(ctx.userId);
  const layout = dashData.layouts.find(l => l.id === dashData.defaultLayoutId) || dashData.layouts[0];
  if (!layout) return err('Brak układu dashboardu do zapisania widgetu.');

  const title = String(input.title || 'Widget AI');
  const def = getWidgetDef('custom_explorer');
  const widget: WidgetInstance = {
    id: generateWidgetId(),
    type: 'custom_explorer',
    x: 0,
    y: Infinity,
    w: def?.defaultSize.w ?? 8,
    h: def?.defaultSize.h ?? 5,
    config: { title, ...spec },
  };
  layout.widgets = [...layout.widgets, widget];
  layout.updatedAt = new Date().toISOString();

  const { error } = await getSupabaseAdmin()
    .from('user_profiles')
    .upsert({ user_id: ctx.userId, email: ctx.userEmail, dashboard_layout: dashData }, { onConflict: 'user_id' });
  if (error) return err(`Nie udało się zapisać widgetu: ${error.message}`);

  return {
    content: JSON.stringify({ ok: true, message: `Widget "${title}" dodany do "${layout.name}".` }),
    artifact: { type: 'widget_created', title, layoutName: layout.name },
    step: { kind: 'widget', label: title },
  };
}

async function handleCreateKpi(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  if (!ctx.isAdmin) {
    return err('Tylko administrator może dodawać definicje KPI do wspólnego rejestru.');
  }
  const rawSpec = (input.query_spec || {}) as Record<string, unknown>;
  const spec = {
    chart_type: String(rawSpec.chart_type || 'bar'),
    x_axis: String(rawSpec.x_axis || 'date'),
    y_axis: String(rawSpec.y_axis || 'revenue_gross'),
    group_by: rawSpec.group_by ? String(rawSpec.group_by) : '',
    granularity: String(rawSpec.granularity || 'month'),
    filters_advanced: Array.isArray(rawSpec.filters_advanced) ? rawSpec.filters_advanced : [],
  } as QuerySpec;

  const errors = validateQuerySpec(spec);
  if (errors.length) return err(`Niepoprawny query_spec KPI: ${errors.join('; ')}`);

  const { data, error } = await getSupabaseAdmin()
    .from('kpi_definitions')
    .insert({
      name: String(input.name || 'KPI'),
      description: input.description ? String(input.description) : null,
      category: String(input.category || 'Ogólne'),
      tier: ['core', 'standard', 'experimental'].includes(String(input.tier)) ? String(input.tier) : 'standard',
      value_type: ['currency', 'number', 'percent', 'ratio'].includes(String(input.value_type)) ? String(input.value_type) : 'number',
      query_spec: spec,
      created_by: ctx.userId,
    })
    .select('id, name, category')
    .single();
  if (error) return err(`Nie udało się zapisać KPI: ${error.message}`);

  return {
    content: JSON.stringify({ ok: true, message: `KPI "${data.name}" dodane do rejestru.` }),
    artifact: { type: 'kpi_created', kpiId: data.id, name: data.name, category: data.category },
    step: { kind: 'kpi', label: data.name },
  };
}

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  switch (name) {
    case 'get_schema':
      return { content: `${DB_SCHEMA_DESCRIPTION}\n\n${WIDGET_SPEC_REFERENCE}` };
    case 'run_sql':
      return handleRunSql(input);
    case 'show_chart':
      return handleShowChart(input);
    case 'create_widget':
      return handleCreateWidget(input, ctx);
    case 'create_kpi':
      return handleCreateKpi(input, ctx);
    default:
      return err(`Nieznane narzędzie: ${name}`);
  }
}

// Predefiniowane formuły dla pivot table. Każdy template to formuła
// po nazwach raw metryk + ewentualnie wcześniej obliczonych template'ów.
// Format: docelowy typ wyświetlania (pln/pct/ratio/number).
//
// Operują na scalonym scope, gdzie brakujące metryki = 0 (patrz evaluateFormula).

import type { PivotFormat } from './explorer-whitelist';
import { evaluateFormula } from './pivot-formula';

export interface TemplateDef {
  key: string;
  label: string;
  expr: string;
  format: PivotFormat;
}

export const PIVOT_TEMPLATES: TemplateDef[] = [
  {
    key: 'roas',
    label: 'Blended ROAS',
    expr: '(meta_revenue + ga_revenue) / (meta_spend + google_spend)',
    format: 'ratio',
  },
  {
    key: 'marketing_pct',
    label: 'Marketing %',
    expr: '(meta_spend + google_spend + agency_cost) / revenue_gross * 100',
    format: 'pct',
  },
  {
    key: 'profit_after_mkt',
    label: 'Profit po marketingu',
    expr: 'revenue_gross - meta_spend - google_spend - agency_cost',
    format: 'pln',
  },
  {
    key: 'cpa',
    label: 'CPA',
    expr: '(meta_spend + google_spend) / (meta_conversions + transactions)',
    format: 'pln',
  },
  {
    key: 'cpm',
    label: 'CPM',
    expr: 'meta_spend / meta_impressions * 1000',
    format: 'pln',
  },
  {
    key: 'conv_rate',
    label: 'Conv. Rate',
    expr: 'transactions / sessions * 100',
    format: 'pct',
  },
];

export function getTemplate(key: string): TemplateDef | undefined {
  return PIVOT_TEMPLATES.find(t => t.key === key);
}

export function evaluateTemplate(key: string, scope: Record<string, number>): number {
  const t = getTemplate(key);
  if (!t) return 0;
  return evaluateFormula(t.expr, scope);
}

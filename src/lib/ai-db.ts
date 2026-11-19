import { getSupabaseAdmin } from './supabase';
import { guardSql } from './sql-guard';

export interface AiQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  error?: string;
}

const ROW_CAP = 1000; // musi być zgodne z LIMIT w funkcji ai_run_readonly_query

// Wykonuje zapytanie wygenerowane przez AI przez funkcję
// ai_run_readonly_query() (migracja 008). Walidacja sql-guard działa
// PRZED bazą; sama baza wymusza read-only + SELECT-only + timeout.
// Błędy są zwracane, nie rzucane — model ma je zobaczyć i poprawić zapytanie.
export async function runAiQuery(rawSql: unknown): Promise<AiQueryResult> {
  const empty = { columns: [], rows: [], rowCount: 0, truncated: false };

  const guard = guardSql(rawSql);
  if (!guard.ok) {
    return { ...empty, error: guard.error };
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .rpc('ai_run_readonly_query', { query_text: guard.sql });

    if (error) {
      return { ...empty, error: error.message };
    }

    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: rows.length >= ROW_CAP,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

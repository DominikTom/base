// Walidacja zapytań SQL generowanych przez AI — obrona w głąb.
//
// To NIE jest jedyna linia obrony. Twardym zabezpieczeniem jest funkcja
// ai_run_readonly_query() (migracja 008): rola ai_readonly z samym SELECT,
// transakcja read-only, statement_timeout, opakowanie w podzapytanie.
// Ten moduł odrzuca oczywiście złośliwe zapytania WCZEŚNIEJ i zwraca
// czytelny komunikat, zamiast surowego błędu uprawnień z bazy.

export type SqlGuardResult =
  | { ok: true; sql: string }
  | { ok: false; error: string };

// Usuwa komentarze SQL (-- ... oraz /* ... */) z poszanowaniem literałów
// tekstowych ('...') i identyfikatorów ("..."), żeby nie wyciąć treści
// ze stringa. Konserwatywnie: w razie wątpliwości raczej zostawia tekst.
function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  let inSingle = false; // '...'
  let inDouble = false; // "..."

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (inSingle) {
      out += c;
      if (c === "'") {
        if (next === "'") { out += next; i += 2; continue; } // '' escape
        inSingle = false;
      }
      i++;
      continue;
    }
    if (inDouble) {
      out += c;
      if (c === '"') {
        if (next === '"') { out += next; i += 2; continue; }
        inDouble = false;
      }
      i++;
      continue;
    }

    if (c === "'") { inSingle = true; out += c; i++; continue; }
    if (c === '"') { inDouble = true; out += c; i++; continue; }

    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

// Zastępuje zawartość literałów tekstowych ('...') spacjami, żeby skan słów
// kluczowych nie reagował na dane (np. coupon_code = 'CREATE2024').
function blankStringLiterals(sql: string): string {
  let out = '';
  let inSingle = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];
    if (inSingle) {
      if (c === "'") {
        if (next === "'") { out += '  '; i++; continue; } // '' escape
        inSingle = false;
        out += "'";
      } else {
        out += ' ';
      }
      continue;
    }
    if (c === "'") { inSingle = true; out += "'"; continue; }
    out += c;
  }
  return out;
}

// Czy poza literałami tekstowymi występuje średnik (poza ewentualnym
// pojedynczym na końcu) — wskazuje na próbę połączenia kilku instrukcji.
function hasInnerSemicolon(sql: string): boolean {
  let inSingle = false, inDouble = false;
  const trimmedEnd = sql.replace(/\s*;?\s*$/, ''); // utnij jeden końcowy ';'
  for (let i = 0; i < trimmedEnd.length; i++) {
    const c = trimmedEnd[i];
    if (inSingle) { if (c === "'") inSingle = false; continue; }
    if (inDouble) { if (c === '"') inDouble = false; continue; }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === ';') return true;
  }
  return false;
}

// Słowa kluczowe, które nie mają prawa wystąpić w czysto-odczytowym SELECT.
const FORBIDDEN_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate',
  'grant', 'revoke', 'copy', 'merge', 'call', 'do', 'vacuum', 'analyze',
  'reindex', 'cluster', 'comment', 'lock', 'listen', 'notify', 'prepare',
  'execute', 'deallocate', 'begin', 'commit', 'rollback', 'savepoint',
  'set', 'reset', 'refresh', 'import', 'into',
];

// Niebezpieczne funkcje (I/O plików, sieć, sterowanie sesją, opóźnienia).
const FORBIDDEN_FUNCTIONS = [
  'pg_sleep', 'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir',
  'pg_stat_file', 'lo_import', 'lo_export', 'dblink', 'set_config',
  'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf',
];

// Obiekty poza zasięgiem AI (rola ai_readonly i tak ich nie ma w GRANT,
// ale czytelny komunikat jest lepszy niż "permission denied").
const FORBIDDEN_OBJECTS = [
  'pg_catalog', 'information_schema', 'auth.', 'user_profiles',
  'ai_conversations', 'ai_messages', 'kpi_definitions',
  'raw_erp_orders', 'raw_meta_campaigns', 'raw_ga4_traffic',
  'raw_pinterest_campaigns', 'etl_quarantine', 'reconciliation_log',
];

export function guardSql(rawSql: unknown): SqlGuardResult {
  if (typeof rawSql !== 'string' || !rawSql.trim()) {
    return { ok: false, error: 'Puste zapytanie SQL.' };
  }

  const stripped = stripComments(rawSql).trim();
  if (!stripped) {
    return { ok: false, error: 'Zapytanie zawiera wyłącznie komentarze.' };
  }

  if (hasInnerSemicolon(stripped)) {
    return { ok: false, error: 'Dozwolona jest tylko jedna instrukcja SQL (znaleziono średnik).' };
  }

  // Utnij pojedynczy końcowy średnik — to, co trafi do RPC.
  const sql = stripped.replace(/\s*;\s*$/, '');

  if (!/^\s*(select|with)\b/i.test(sql)) {
    return { ok: false, error: 'Dozwolone są wyłącznie zapytania SELECT (lub WITH ... SELECT).' };
  }

  // Skan słów kluczowych na wersji bez zawartości stringów — żeby dane
  // (np. nazwy produktów, kody kuponów) nie wywoływały fałszywych alarmów.
  const lower = blankStringLiterals(sql).toLowerCase();

  for (const kw of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(lower)) {
      return { ok: false, error: `Niedozwolone słowo kluczowe: ${kw.toUpperCase()}. Dozwolony jest tylko odczyt danych.` };
    }
  }

  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (lower.includes(fn)) {
      return { ok: false, error: `Niedozwolona funkcja: ${fn}.` };
    }
  }

  for (const obj of FORBIDDEN_OBJECTS) {
    if (lower.includes(obj)) {
      return { ok: false, error: `Brak dostępu do obiektu: ${obj}.` };
    }
  }

  return { ok: true, sql };
}

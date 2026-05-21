import { describe, it, expect } from 'vitest';
import { guardSql } from '../sql-guard';

describe('guardSql', () => {
  it('akceptuje proste SELECT', () => {
    const r = guardSql('SELECT * FROM fact_orders LIMIT 10');
    expect(r.ok).toBe(true);
  });

  it('akceptuje WITH ... SELECT (CTE)', () => {
    const r = guardSql('WITH x AS (SELECT 1 AS n) SELECT n FROM x');
    expect(r.ok).toBe(true);
  });

  it('ucina pojedynczy końcowy średnik', () => {
    const r = guardSql('SELECT 1;');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sql).toBe('SELECT 1');
  });

  it('odrzuca wiele instrukcji', () => {
    const r = guardSql('SELECT 1; DROP TABLE fact_orders');
    expect(r.ok).toBe(false);
  });

  it('odrzuca średnik przemycony między komentarzami', () => {
    const r = guardSql('SELECT 1 /* komentarz */ ; DELETE FROM fact_orders');
    expect(r.ok).toBe(false);
  });

  it('odrzuca DELETE / UPDATE / DROP / INSERT', () => {
    expect(guardSql('DELETE FROM fact_orders').ok).toBe(false);
    expect(guardSql('UPDATE fact_orders SET status = 1').ok).toBe(false);
    expect(guardSql('DROP TABLE fact_orders').ok).toBe(false);
    expect(guardSql('INSERT INTO fact_orders VALUES (1)').ok).toBe(false);
  });

  it('odrzuca SELECT z dopisanym INSERT/UPDATE w jednej instrukcji', () => {
    expect(guardSql('SELECT * FROM fact_orders WHERE 1=1 UNION SELECT 1; UPDATE x SET y=1').ok).toBe(false);
  });

  it('odrzuca zapytania nie-SELECT', () => {
    expect(guardSql('TRUNCATE fact_orders').ok).toBe(false);
    expect(guardSql('GRANT ALL ON fact_orders TO public').ok).toBe(false);
  });

  it('odrzuca niebezpieczne funkcje', () => {
    expect(guardSql('SELECT pg_sleep(20)').ok).toBe(false);
    expect(guardSql('SELECT pg_read_file(\'/etc/passwd\')').ok).toBe(false);
  });

  it('odrzuca dostęp do obiektów poza zasięgiem', () => {
    expect(guardSql('SELECT * FROM information_schema.tables').ok).toBe(false);
    expect(guardSql('SELECT * FROM user_profiles').ok).toBe(false);
    expect(guardSql('SELECT * FROM auth.users').ok).toBe(false);
    expect(guardSql('SELECT * FROM ai_messages').ok).toBe(false);
  });

  it('odrzuca DML przemycony w komentarzu liniowym z nową linią', () => {
    const r = guardSql('SELECT 1 --\n; DROP TABLE fact_orders');
    expect(r.ok).toBe(false);
  });

  it('akceptuje słowo kluczowe występujące w danych (literał tekstowy)', () => {
    expect(guardSql("SELECT * FROM fact_orders WHERE coupon_code = 'CREATE2024'").ok).toBe(true);
    expect(guardSql("SELECT * FROM fact_order_items WHERE product_name = 'do not drop'").ok).toBe(true);
  });

  it('odrzuca puste / samokomentarzowe zapytania', () => {
    expect(guardSql('').ok).toBe(false);
    expect(guardSql('   ').ok).toBe(false);
    expect(guardSql('-- tylko komentarz').ok).toBe(false);
  });
});

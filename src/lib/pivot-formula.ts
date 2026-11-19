// Bezpieczny evaluator wyrażeń arytmetycznych dla computed columns w pivocie.
// Obsługa: + − * / %, nawiasy, literały numeryczne, identyfikatory (zmienne).
// BRAK: Function, eval, ?:, własności obiektu, funkcji, wywołań.
// Identyfikator nieobecny w `scope` => 0 (dzięki temu wiersz z brakiem
// jednego datasetu nie wybucha całej tabeli).
// Dzielenie przez 0 => 0. NaN/Infinity => 0.

type Token =
  | { type: 'num'; value: number }
  | { type: 'id'; value: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '%' | '(' | ')' };

const OP_CHARS = new Set(['+', '-', '*', '/', '%', '(', ')']);

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (OP_CHARS.has(c)) {
      out.push({ type: 'op', value: c as '+' });
      i++;
      continue;
    }
    if (c === '.' || (c >= '0' && c <= '9')) {
      let j = i;
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
      const num = parseFloat(src.slice(i, j));
      if (!Number.isFinite(num)) throw new Error(`Niepoprawny literał liczbowy: ${src.slice(i, j)}`);
      out.push({ type: 'num', value: num });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ type: 'id', value: src.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`Niedozwolony znak w wyrażeniu: ${c}`);
  }
  return out;
}

// Pratt parser. Returns AST.
type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'id'; name: string }
  | { kind: 'neg'; arg: Expr }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '%'; left: Expr; right: Expr };

function precedence(op: string): number {
  if (op === '+' || op === '-') return 1;
  if (op === '*' || op === '/' || op === '%') return 2;
  return 0;
}

class Parser {
  pos = 0;
  constructor(public tokens: Token[]) {}
  peek(): Token | undefined { return this.tokens[this.pos]; }
  next(): Token | undefined { return this.tokens[this.pos++]; }
  expect(value: string): void {
    const t = this.next();
    if (!t || t.type !== 'op' || t.value !== value) throw new Error(`Oczekiwano ${value}`);
  }
  parsePrimary(): Expr {
    const t = this.next();
    if (!t) throw new Error('Nieoczekiwany koniec wyrażenia');
    if (t.type === 'num') return { kind: 'num', value: t.value };
    if (t.type === 'id') return { kind: 'id', name: t.value };
    if (t.type === 'op' && t.value === '(') {
      const e = this.parseExpr(0);
      this.expect(')');
      return e;
    }
    if (t.type === 'op' && t.value === '-') {
      return { kind: 'neg', arg: this.parsePrimary() };
    }
    if (t.type === 'op' && t.value === '+') {
      return this.parsePrimary();
    }
    throw new Error(`Nieoczekiwany token: ${String((t as { value: unknown }).value)}`);
  }
  parseExpr(minPrec: number): Expr {
    let left = this.parsePrimary();
    while (true) {
      const t = this.peek();
      if (!t || t.type !== 'op' || t.value === ')' || t.value === '(') break;
      const prec = precedence(t.value);
      if (prec < minPrec || prec === 0) break;
      this.next();
      const right = this.parseExpr(prec + 1);
      left = { kind: 'bin', op: t.value as '+', left, right };
    }
    return left;
  }
}

export function parseFormula(expr: string): Expr {
  const tokens = tokenize(expr);
  if (tokens.length === 0) throw new Error('Puste wyrażenie');
  const p = new Parser(tokens);
  const ast = p.parseExpr(0);
  if (p.pos < tokens.length) {
    const rest = tokens.slice(p.pos);
    throw new Error(`Niepoprawna składnia, niewykorzystane tokeny: ${rest.map(t => (t.type === 'op' ? t.value : String(t.value))).join(' ')}`);
  }
  return ast;
}

function evalAst(ast: Expr, scope: Record<string, number>): number {
  switch (ast.kind) {
    case 'num': return ast.value;
    case 'id': {
      const v = scope[ast.name];
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    }
    case 'neg': return -evalAst(ast.arg, scope);
    case 'bin': {
      const l = evalAst(ast.left, scope);
      const r = evalAst(ast.right, scope);
      let v: number;
      switch (ast.op) {
        case '+': v = l + r; break;
        case '-': v = l - r; break;
        case '*': v = l * r; break;
        case '/': v = r === 0 ? 0 : l / r; break;
        case '%': v = r === 0 ? 0 : l % r; break;
      }
      return Number.isFinite(v) ? v : 0;
    }
  }
}

export function evaluateFormula(expr: string, scope: Record<string, number>): number {
  try {
    const ast = parseFormula(expr);
    return evalAst(ast, scope);
  } catch {
    return 0;
  }
}

// Sprawdza, czy wyrażenie jest poprawne i czy używa tylko zmiennych z whitelist.
// Zwraca listę błędów (pusta = OK).
export function validateFormula(expr: string, allowedIdentifiers: string[]): string[] {
  const errors: string[] = [];
  let ast: Expr;
  try { ast = parseFormula(expr); }
  catch (e) { return [String((e as Error).message)]; }
  const allowed = new Set(allowedIdentifiers);
  function walk(n: Expr) {
    if (n.kind === 'id' && !allowed.has(n.name)) {
      errors.push(`Nieznana nazwa kolumny: ${n.name}`);
    } else if (n.kind === 'neg') walk(n.arg);
    else if (n.kind === 'bin') { walk(n.left); walk(n.right); }
  }
  walk(ast);
  return errors;
}

import { z } from 'zod';
import type { Capability } from './core';

// REST: dopasowanie ścieżki → zdolność, koercja parametrów query do typów ze
// schematu (liczby, booleany, listy po przecinku) i specyfikacja OpenAPI 3.1.

type AnyZod = z.ZodType;

interface FieldInfo {
  kind: 'string' | 'number' | 'boolean' | 'array' | 'other';
  required: boolean;
}

/** Rozpoznaje typ pola, odwijając optional / default / nullable. */
export function fieldInfo(schema: AnyZod): FieldInfo {
  let s = schema as AnyZod;
  let required = true;
  for (let i = 0; i < 5; i++) {
    const t = (s as unknown as { def: { type: string; innerType?: AnyZod } }).def.type;
    if (t === 'optional' || t === 'default' || t === 'nullable' || t === 'prefault') {
      required = false;
      s = (s as unknown as { def: { innerType: AnyZod } }).def.innerType;
      continue;
    }
    if (t === 'number' || t === 'int') return { kind: 'number', required };
    if (t === 'boolean') return { kind: 'boolean', required };
    if (t === 'array') return { kind: 'array', required };
    if (t === 'string' || t === 'enum' || t === 'literal') return { kind: 'string', required };
    return { kind: 'other', required };
  }
  return { kind: 'other', required };
}

/** Zamienia stringi z query/ścieżki na typy oczekiwane przez schemat. */
export function coerceArgs(shape: z.ZodRawShape, raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const schema = shape[key] as AnyZod | undefined;
    if (!schema) { out[key] = value; continue; }
    const { kind } = fieldInfo(schema);
    if (kind === 'number') out[key] = value === '' ? undefined : Number(value);
    else if (kind === 'boolean') out[key] = /^(1|true|tak|yes)$/i.test(value);
    else if (kind === 'array') out[key] = value.split(',').map(v => v.trim()).filter(Boolean);
    else out[key] = value;
  }
  return out;
}

/** Dopasowuje ścieżkę (bez /api/v1/) do zdolności; zwraca też parametry ścieżki. */
export function matchCapability(caps: Capability[], segments: string[]): { cap: Capability; params: Record<string, string> } | null {
  for (const cap of caps) {
    const pattern = cap.path.split('/');
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i];
      if (p.startsWith('{') && p.endsWith('}')) params[p.slice(1, -1)] = decodeURIComponent(segments[i]);
      else if (p !== segments[i]) { ok = false; break; }
    }
    if (ok) return { cap, params };
  }
  return null;
}

/** Specyfikacja OpenAPI 3.1 wygenerowana z rejestru zdolności. */
export function buildOpenApi(caps: Capability[], baseUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const cap of caps) {
    const pathParams = new Set((cap.path.match(/\{([^}]+)\}/g) || []).map(p => p.slice(1, -1)));
    const parameters = Object.entries(cap.input).map(([name, schema]) => {
      const info = fieldInfo(schema as AnyZod);
      const json = z.toJSONSchema(schema as AnyZod, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
      delete json.$schema;
      const description = typeof json.description === 'string' ? json.description : undefined;
      return {
        name,
        in: pathParams.has(name) ? 'path' : 'query',
        required: pathParams.has(name) || info.required,
        ...(description ? { description } : {}),
        ...(info.kind === 'array' ? { style: 'form', explode: false } : {}),
        schema: json,
      };
    });
    paths[`/${cap.path}`] = {
      get: {
        operationId: cap.name,
        summary: cap.title,
        description: cap.description,
        tags: [cap.tag],
        parameters,
        responses: {
          200: { description: 'OK — JSON z polami zależnymi od zasobu (zawsze: warnings, często: definitions).' },
          400: { description: 'Błędne parametry' },
          401: { description: 'Brak lub nieprawidłowy token' },
          403: { description: 'Brak dostępu do sklepu / zasobu' },
          404: { description: 'Nie znaleziono' },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Data Hub MyBed API',
      version: '1.0.0',
      description:
        'Dane MyBed Group tylko do odczytu: reklamy Meta, sprzedaż, produkty, ruch GA4, showroomy. ' +
        'Te same dane i uprawnienia co serwer MCP (/api/mcp). Kwoty w PLN, dni w strefie Europe/Warsaw. ' +
        'Token: dash → Dostęp API i MCP (/dashboard/mcp).',
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Token dmcp_…' } } },
    paths,
  };
}

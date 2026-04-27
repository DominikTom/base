/**
 * Supabase / PostgREST caps every response at 1000 rows.
 * `.limit(50000)` does NOT defeat this — only `.range(start, end)` does.
 *
 * Pass a function that builds a fresh query each call so a different
 * `.range()` can be attached per page. Returns all rows concatenated.
 */
const PAGE_SIZE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllPaginated<T = any>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => any,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

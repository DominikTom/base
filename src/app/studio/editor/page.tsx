import { EditorClient } from './editor-client';

/**
 * Edycja pędzlem: /studio/editor?type=generation|packshot&id=…
 * Dostępna dla każdej wygenerowanej wizualizacji ORAZ surowego packshota.
 */
export default async function EditorPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; id?: string }>;
}) {
  const params = await searchParams;
  const type = params.type === 'packshot' ? 'packshot' : 'generation';
  const id = params.id ?? '';
  return <EditorClient sourceType={type} sourceId={id} />;
}

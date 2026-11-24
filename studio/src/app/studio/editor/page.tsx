import { EditorClient, type EditorTab } from './editor-client';

/**
 * Edycja: /studio/editor?type=generation|packshot&id=…&tab=brush|remove|adjust
 * - bez id: wybór obrazu (wejście z menu "Edycja"),
 * - tab=brush: pędzel AI (zmiana zaznaczenia wg instrukcji / referencji),
 * - tab=remove: gumka — usuwanie zamalowanych obiektów,
 * - tab=adjust: korekty suwakami (jasność, kontrast, temperatura, filtry, presety),
 * - ?reuse=<id edycji> wczytuje maskę i instrukcję tamtej edycji ("Popraw maskę").
 */
export default async function EditorPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; id?: string; reuse?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const type = params.type === 'packshot' ? 'packshot' : 'generation';
  const id = params.id ?? '';
  const tab: EditorTab =
    params.tab === 'remove' || params.tab === 'adjust' ? params.tab : 'brush';
  return <EditorClient sourceType={type} sourceId={id} reuseId={params.reuse ?? null} initialTab={tab} />;
}

import { InspirationSetClient } from './set-client';

export default async function InspirationSetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InspirationSetClient id={id} />;
}

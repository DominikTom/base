import { GenerationDetailClient } from './detail-client';

export default async function GenerationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GenerationDetailClient id={id} />;
}

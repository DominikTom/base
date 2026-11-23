import { BatchClient } from './batch-client';

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BatchClient batchId={id} />;
}

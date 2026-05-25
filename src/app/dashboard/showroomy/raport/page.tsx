import { ReportView } from '@/components/showroom-report';
import { SHOWROOMS, type Showroom } from '@/lib/sensmax/types';
import { buildReportPath } from '@/lib/sensmax/report-link';

export const dynamic = 'force-dynamic';

function resolveRange(from: string, to: string): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = iso(new Date());
  const toR = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : today;
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) return { from, to: toR };
  const d = new Date(`${toR}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 29);
  return { from: iso(d), to: toR };
}

export default async function ShowroomReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = typeof sp.showroom === 'string' ? sp.showroom : '';
  const showroom: Showroom = SHOWROOMS.includes(raw as Showroom) ? (raw as Showroom) : 'katowice';
  const { from, to } = resolveRange(typeof sp.from === 'string' ? sp.from : '', typeof sp.to === 'string' ? sp.to : '');
  const sharePath = buildReportPath(showroom, from, to);
  return <ReportView showroom={showroom} from={from} to={to} sharePath={sharePath} />;
}

import { ReportView } from './ReportView';
import { SHOWROOMS, type Showroom } from '@/lib/sensmax/types';

export const dynamic = 'force-dynamic';

export default async function ShowroomReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = typeof sp.showroom === 'string' ? sp.showroom : '';
  const showroom: Showroom = SHOWROOMS.includes(raw as Showroom) ? (raw as Showroom) : 'katowice';
  const from = typeof sp.from === 'string' ? sp.from : '';
  const to = typeof sp.to === 'string' ? sp.to : '';
  return <ReportView showroom={showroom} from={from} to={to} />;
}

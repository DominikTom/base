import { ReportView } from '@/components/showroom-report';
import { SHOWROOMS, type Showroom } from '@/lib/sensmax/types';
import { verifyReportLink } from '@/lib/sensmax/report-link';

export const dynamic = 'force-dynamic';

export default async function PublicShowroomReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const showroomRaw = typeof sp.showroom === 'string' ? sp.showroom : '';
  const from = typeof sp.from === 'string' ? sp.from : '';
  const to = typeof sp.to === 'string' ? sp.to : '';
  const sig = typeof sp.sig === 'string' ? sp.sig : undefined;

  const valid =
    SHOWROOMS.includes(showroomRaw as Showroom) &&
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    verifyReportLink(showroomRaw, from, to, sig);

  if (!valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6 text-zinc-700">
        <div className="max-w-md rounded-lg border border-zinc-300 bg-white p-6 text-center text-sm">
          Link do raportu jest nieprawidłowy. Poproś o nowy link osobę, która go wygenerowała.
        </div>
      </div>
    );
  }

  return <ReportView showroom={showroomRaw as Showroom} from={from} to={to} publicMode />;
}

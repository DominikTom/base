import { redirect } from 'next/navigation';
import { getAuthUser, isAdmin } from '@/lib/auth';

// Server-side guard — strona renderuje się dopiero gdy user jest adminem.
// Non-admin / niezalogowani lecą redirectem zanim cokolwiek się odrysuje.
export default async function AdminGuardLayout({ children }: { children: React.ReactNode }) {
  const { user, supabase } = await getAuthUser();
  if (!user) redirect('/login');
  if (!(await isAdmin(supabase, user.id))) redirect('/dashboard/overview?error=admin_required');
  return <>{children}</>;
}

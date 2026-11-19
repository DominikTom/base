import { redirect } from 'next/navigation';
import { getAuthUser, isAdmin } from '@/lib/auth';

export default async function CostsGuardLayout({ children }: { children: React.ReactNode }) {
  const { user, supabase } = await getAuthUser();
  if (!user) redirect('/login');
  if (!(await isAdmin(supabase, user.id))) redirect('/dashboard/overview?error=admin_required');
  return <>{children}</>;
}

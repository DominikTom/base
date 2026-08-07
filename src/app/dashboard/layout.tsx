import { DashboardProvider } from '@/lib/dashboard-context';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <div className="min-h-screen bg-canvas app-ambient text-ink-soft">
        <Sidebar />
        <div className="pl-60">
          <Topbar />
          <main className="p-6">
            {children}
          </main>
        </div>
      </div>
    </DashboardProvider>
  );
}

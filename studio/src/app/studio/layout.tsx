import type { Metadata } from 'next';
import { StudioSidebar } from '@/components/studio/sidebar-nav';
import { ToastProvider } from '@/components/studio/toast';

export const metadata: Metadata = {
  title: 'MyBed Visual Studio',
  description: 'Generowanie i edycja wizualizacji produktowych MyBed Group',
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-studio-bg text-studio-ink">
      <ToastProvider>
        <StudioSidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>
        </main>
      </ToastProvider>
    </div>
  );
}

import type { Metadata } from 'next';
import { StudioNotifications } from '@/components/studio/notifications';
import { StudioSidebar } from '@/components/studio/sidebar-nav';
import { ToastProvider } from '@/components/studio/toast';

export const metadata: Metadata = {
  title: 'MyBed Visual Studio',
  description: 'Generowanie i edycja wizualizacji produktowych MyBed Group',
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-studio-bg text-studio-ink md:flex">
      <ToastProvider>
        <StudioNotifications />
        <StudioSidebar />
        <main className="min-w-0 flex-1">
          <div
            className="mx-auto max-w-7xl px-4 py-5 md:px-8 md:py-8"
            style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
          >
            {children}
          </div>
        </main>
      </ToastProvider>
    </div>
  );
}

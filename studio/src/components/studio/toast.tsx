'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

const ToastContext = createContext<{
  toast: (kind: Toast['kind'], message: string) => void;
}>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((kind: Toast['kind'], message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, kind === 'error' ? 8000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 z-[100] flex flex-col gap-2 sm:inset-x-auto sm:right-6 sm:w-96 sm:max-w-[calc(100vw-3rem)]"
        style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur ${
              t.kind === 'error'
                ? 'border-red-500/30 bg-red-950/90 text-red-200 light:border-red-300 light:bg-red-50/95 light:text-red-800'
                : t.kind === 'success'
                  ? 'border-emerald-500/30 bg-emerald-950/90 text-emerald-200 light:border-emerald-300 light:bg-emerald-50/95 light:text-emerald-800'
                  : 'border-studio-border bg-studio-surface text-studio-ink'
            }`}
          >
            {t.kind === 'success' && <Check className="mt-0.5 h-4 w-4 shrink-0" />}
            <p className="flex-1 text-sm leading-snug">{t.message}</p>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="shrink-0 opacity-50 transition-opacity hover:opacity-100"
              aria-label="Zamknij"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

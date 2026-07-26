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
      <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-96 max-w-[calc(100vw-3rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur ${
              t.kind === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : t.kind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
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

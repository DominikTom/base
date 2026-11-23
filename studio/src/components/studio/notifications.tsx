'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/components/studio/toast';
import { apiGet } from '@/lib/studio/client';

interface Recent {
  id: string;
  status: 'pending' | 'done' | 'error';
  batch_id: string | null;
  error_message: string | null;
}

/**
 * Globalne powiadomienia o generacjach: cichy poll ostatnich rekordów i toast,
 * gdy coś przejdzie z „pending" na „done"/„error" — niezależnie od tego, na
 * której podstronie studia jesteś.
 */
export function StudioNotifications() {
  const { toast } = useToast();
  const prevStatus = useRef<Map<string, Recent['status']>>(new Map());
  const primed = useRef(false);

  useEffect(() => {
    let timer: number | null = null;
    let stopped = false;

    async function tick() {
      if (document.visibilityState !== 'visible') return;
      try {
        const d = await apiGet<{ generations: Recent[] }>('/api/studio/generations?limit=30');
        const prev = prevStatus.current;
        if (primed.current) {
          const finishedBatches = new Set<string>();
          for (const g of d.generations) {
            const before = prev.get(g.id);
            if (before === 'pending' && g.status !== 'pending') {
              if (g.batch_id) {
                finishedBatches.add(g.batch_id);
              } else if (g.status === 'done') {
                toast('success', 'Wizualizacja gotowa ✓');
              } else {
                toast('error', `Generacja nie powiodła się: ${g.error_message?.slice(0, 120) ?? 'błąd'}`);
              }
            }
          }
          for (const batchId of finishedBatches) {
            const inBatch = d.generations.filter((g) => g.batch_id === batchId);
            if (inBatch.every((g) => g.status !== 'pending')) {
              const errors = inBatch.filter((g) => g.status === 'error').length;
              toast(
                errors > 0 ? 'error' : 'success',
                errors > 0 ? `Seria ukończona — ${errors} z błędem.` : 'Seria ukończona ✓'
              );
            } else {
              toast('success', 'Kolejna wizualizacja z serii gotowa ✓');
            }
          }
        }
        for (const g of d.generations) prev.set(g.id, g.status);
        primed.current = true;
      } catch {
        // Cichy poll — błędy sieci nie zasypują użytkownika toastami.
      }
    }

    void tick();
    timer = window.setInterval(() => {
      if (!stopped) void tick();
    }, 9000);
    return () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
    };
  }, [toast]);

  return null;
}

'use client';

import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Button({
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-studio-accent text-white hover:bg-studio-accent-dark',
        variant === 'secondary' &&
          'border border-studio-border bg-studio-surface text-studio-ink hover:bg-studio-accent-soft',
        variant === 'ghost' && 'text-studio-muted hover:bg-studio-accent-soft hover:text-studio-ink',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-studio-border bg-studio-surface shadow-[0_1px_3px_rgba(38,34,31,0.06)]',
        className
      )}
      {...props}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('h-5 w-5 animate-spin text-studio-accent', className)} />;
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-studio-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-studio-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-studio-border py-16 text-center">
      {icon && <div className="text-studio-muted">{icon}</div>}
      <p className="font-medium text-studio-ink">{title}</p>
      {hint && <p className="max-w-md text-sm text-studio-muted">{hint}</p>}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'error' | 'pending';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-studio-bg text-studio-muted',
        tone === 'accent' && 'bg-studio-accent-soft text-studio-accent-dark',
        tone === 'success' && 'bg-emerald-100 text-emerald-700',
        tone === 'error' && 'bg-red-100 text-red-700',
        tone === 'pending' && 'bg-amber-100 text-amber-700'
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: 'pending' | 'done' | 'error' }) {
  if (status === 'pending') {
    return (
      <Badge tone="pending">
        <LoaderCircle className="h-3 w-3 animate-spin" /> Generowanie…
      </Badge>
    );
  }
  if (status === 'error') return <Badge tone="error">Błąd</Badge>;
  return <Badge tone="success">Gotowe</Badge>;
}

export function labelForStrength(level: number): string {
  switch (level) {
    case 1:
      return 'Subtelna sugestia kolorystyki';
    case 2:
      return 'Paleta + materiały';
    case 3:
      return 'Paleta, materiały i nastrój';
    case 4:
      return 'Mocne odwzorowanie stylu';
    case 5:
      return 'Wierne odtworzenie klimatu';
    default:
      return '';
  }
}

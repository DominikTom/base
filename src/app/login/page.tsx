'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { LogoMark } from '@/components/ui/logo-mark';
import { ThemeToggle } from '@/components/ui/theme-toggle';

const ALLOWED_DOMAINS = ['mybed.pl', 'mybed.de', 'mittohome.pl'];
const BRANDS = ['MyBed.pl', 'MyBed.de', 'MittoHome.pl'];

function GoogleLogo() {
  // Logotyp marki zewnętrznej — jedyny dozwolony wyjątek od zakazu hexów
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get('error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam === 'domain'
      ? `Email musi być w domenie: ${ALLOWED_DOMAINS.join(', ')}.`
      : errorParam === 'auth_failed'
      ? 'Logowanie nie powiodło się. Spróbuj ponownie.'
      : null,
  );

  function getClient() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error } = await getClient().auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message === 'Invalid login credentials'
          ? 'Nieprawidłowy email lub hasło'
          : error.message);
      } else {
        router.push('/dashboard/overview');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    setError(null);
    try {
      const origin = window.location.origin;
      const { error } = await getClient().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${origin}/auth/callback?next=/dashboard/overview`,
          // Restrict do domen MyBed obsługujemy w /auth/callback (Supabase OAuth
          // nie ma server-side hint dla `hd` po stronie clienta).
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
      if (error) {
        setError(error.message);
        setGoogleLoading(false);
      }
      // przy sukcesie nastąpi redirect Google → /auth/callback → /dashboard
    } catch (err) {
      setError(String(err));
      setGoogleLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Hero — zawsze ciemny panel z poświatą (kontekst .dark) */}
      <div className="dark relative hidden w-1/2 flex-col justify-between overflow-hidden bg-canvas p-10 lg:flex">
        <div className="app-ambient pointer-events-none absolute inset-0" />

        <div className="relative flex items-center gap-3">
          <LogoMark size={28} />
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-ink">MyBed Group</span>
            <span className="font-mono text-[11px] text-ink-faint">Data Dashboard</span>
          </div>
        </div>

        <div className="relative max-w-lg">
          <p className="font-mono text-xs text-accent-ink">Wewnętrzna hurtownia danych</p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.08] tracking-tight text-ink">
            Jedno miejsce.
            <br />
            Wszystkie dane.
            <br />
            Pełna jasność.
          </h1>
          <p className="mt-6 text-sm leading-relaxed text-ink-muted">
            Sprzedaż, zamówienia, marketing i ruch wszystkich marek MyBed Group
            — w jednym, wspólnym widoku.
          </p>
        </div>

        <div className="relative flex items-center gap-3 font-mono text-[11px] text-ink-faint">
          {BRANDS.map((brand, i) => (
            <span key={brand} className="flex items-center gap-3">
              {i > 0 && <span className="text-line">•</span>}
              {brand}
            </span>
          ))}
        </div>
      </div>

      {/* Panel logowania — podąża za motywem */}
      <div className="flex flex-1 flex-col items-center justify-center bg-canvas px-4 py-10">
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <LogoMark size={28} />
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-ink">MyBed Group</span>
            <span className="font-mono text-[11px] text-ink-faint">Data Dashboard</span>
          </div>
        </div>

        <div className="card w-full max-w-sm p-6 shadow-soft">
          <p className="font-mono text-xs text-primary-ink">Bezpieczny dostęp</p>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-ink">Zaloguj się</h2>
          <p className="mt-1 text-sm text-ink-muted">Kontem firmowym @mybed.pl.</p>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading || loading}
            className="btn-secondary mt-6 w-full py-2.5"
          >
            <GoogleLogo />
            {googleLoading ? 'Łączenie z Google…' : 'Zaloguj przez Google'}
          </button>

          {!showEmailForm && (
            <button
              type="button"
              onClick={() => setShowEmailForm(true)}
              className="mt-4 w-full text-center text-sm font-semibold text-primary-ink hover:underline"
            >
              Zaloguj e-mailem i hasłem
            </button>
          )}

          {showEmailForm && (
            <form onSubmit={handleLogin} className="mt-5 space-y-4 animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-line" />
                <span className="text-xs text-ink-faint">lub e-mailem</span>
                <div className="h-px flex-1 bg-line" />
              </div>

              <div>
                <label className="stat-label mb-1.5 block">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="imie@mybed.pl"
                  required
                  className="input"
                />
              </div>

              <div>
                <label className="stat-label mb-1.5 block">Hasło</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="input"
                />
              </div>

              <button type="submit" disabled={loading || googleLoading} className="btn-primary w-full py-2.5">
                {loading ? 'Logowanie…' : 'Zaloguj się'}
              </button>
            </form>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <p className="mt-6 text-xs leading-relaxed text-ink-faint">
            Dostęp mają konta @mybed.pl oraz e-maile w domenach:{' '}
            <span className="font-mono">{ALLOWED_DOMAINS.join(' · ')}</span>.
          </p>
        </div>

        <ThemeToggle variant="segmented" className="mt-4" />
      </div>
    </div>
  );
}

// useSearchParams musi być w Suspense (Next.js 15+).
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <LoginPageInner />
    </Suspense>
  );
}

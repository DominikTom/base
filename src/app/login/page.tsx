'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Mail, Lock, AlertCircle } from 'lucide-react';

const ALLOWED_DOMAINS = ['mybed.pl', 'mybed.de', 'mittohome.pl'];

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get('error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
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
    <div className="min-h-screen bg-bg flex items-center justify-center p-6 relative overflow-hidden">
      {/* Subtle gradient blobs in tle */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 w-[40rem] h-[40rem] rounded-full opacity-50"
        style={{ background: 'radial-gradient(circle at center, #E9D5FF 0%, #FAF5FF 50%, transparent 75%)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-32 w-[36rem] h-[36rem] rounded-full opacity-40"
        style={{ background: 'radial-gradient(circle at center, #F3E8FF 0%, #FAF5FF 50%, transparent 75%)' }}
      />

      <div className="relative w-full max-w-md">
        <div className="bg-surface border border-line rounded-card shadow-card p-8 sm:p-10">
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-accent-bg text-accent-fg flex items-center justify-center font-bold text-xl">
              MB
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold text-fg tracking-tight">MyBed Group</h1>
              <p className="text-sm text-muted mt-0.5">Data Dashboard</p>
            </div>
          </div>

          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading || loading}
            className="w-full flex items-center justify-center gap-2.5 px-5 py-3 rounded-pill border border-line bg-surface hover:bg-bg text-fg text-sm font-medium transition-colors disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            {googleLoading ? 'Łączenie z Google…' : 'Zaloguj się przez Google'}
          </button>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-line" />
            <span className="text-[11px] uppercase tracking-wider text-muted">lub email</span>
            <div className="flex-1 h-px bg-line" />
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-fg-soft mb-1.5">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="imie@mybed.pl"
                  required
                  className="w-full pl-10 pr-4 py-3 rounded-pill bg-bg border border-line text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-fg-soft mb-1.5">Hasło</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-10 pr-4 py-3 rounded-pill bg-bg border border-line text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-transparent"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full px-6 py-3 btn-primary-gradient font-medium rounded-pill transition-colors disabled:opacity-50"
            >
              {loading ? 'Logowanie…' : 'Zaloguj się'}
            </button>

            {error && (
              <div className="flex items-start gap-2 text-sm text-danger bg-rose-50 border border-rose-200 rounded-2xl p-3">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </form>

          <p className="text-[11px] text-muted text-center mt-6">
            Logowanie przez Google dozwolone tylko dla domen:<br />
            <span className="font-mono">{ALLOWED_DOMAINS.join(' · ')}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// useSearchParams musi być w Suspense (Next.js 15+).
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <LoginPageInner />
    </Suspense>
  );
}

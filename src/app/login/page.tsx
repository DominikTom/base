'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * TODO(google-oauth): docelowo logowanie Google OAuth ograniczone do domeny
 * @mybed.pl. Kroki (nie implementować bez decyzji zespołu):
 * 1. Supabase Dashboard → Authentication → Providers → Google (client ID/secret
 *    z Google Cloud Console, authorized redirect:
 *    https://sebckrbvoghfdrppdxyt.supabase.co/auth/v1/callback).
 * 2. W formularzu poniżej: supabase.auth.signInWithOAuth({ provider: 'google',
 *    options: { queryParams: { hd: 'mybed.pl' } } }) + weryfikacja domeny
 *    e-maila po stronie serwera (hook lub trigger na auth.users).
 * Rejestracja e-mail+hasło pozostaje wyłączona publicznie — konta zakłada
 * admin w panelu Supabase (Authentication → Users → Add user).
 */

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message === 'Invalid login credentials'
          ? 'Nieprawidłowy email lub hasło'
          : error.message);
      } else {
        const next = new URLSearchParams(window.location.search).get('next');
        router.push(next && next.startsWith('/') ? next : '/dashboard/overview');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-full max-w-sm mx-auto p-8">
        <div className="flex flex-col items-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-bold text-2xl">
            MB
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-zinc-100">MyBed Group</h1>
            <p className="text-sm text-zinc-500 mt-1">Data Dashboard</p>
          </div>

          <form onSubmit={handleLogin} className="w-full space-y-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="imie@mybed.pl"
                required
                className="w-full px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Hasło</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Logowanie...' : 'Zaloguj się'}
            </button>

            {error && (
              <p className="text-sm text-red-400 text-center">{error}</p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

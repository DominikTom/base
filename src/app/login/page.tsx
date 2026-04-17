'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
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

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setError(error.message);
      } else {
        setSent(true);
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

          {sent ? (
            <div className="w-full text-center space-y-4">
              <div className="p-4 rounded-lg bg-emerald-900/20 border border-emerald-800">
                <p className="text-emerald-400 font-medium">Link wysłany!</p>
                <p className="text-sm text-zinc-400 mt-2">
                  Sprawdź skrzynkę <span className="text-zinc-200">{email}</span> i kliknij link logowania.
                </p>
              </div>
              <button
                onClick={() => { setSent(false); setError(null); }}
                className="text-sm text-zinc-500 hover:text-zinc-300"
              >
                Wyślij ponownie
              </button>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="w-full space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Email służbowy</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="imie@mybed.pl"
                  required
                  className="w-full px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? 'Wysyłanie...' : 'Wyślij link logowania'}
              </button>

              {error && (
                <p className="text-sm text-red-400 text-center">{error}</p>
              )}

              <p className="text-xs text-zinc-600 text-center">
                Otrzymasz email z jednorazowym linkiem do logowania. Bez hasła.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

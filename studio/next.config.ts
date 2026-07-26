import type { NextConfig } from "next";

// Fallbacki na wypadek braku env vars w projekcie Vercel — URL i klucz anon
// Supabase są publiczne z założenia (dostęp chroni RLS). Zmienne ustawione
// w Vercel (Settings → Environment Variables) mają pierwszeństwo.
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://sebckrbvoghfdrppdxyt.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNlYmNrcmJ2b2doZmRycHBkeHl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODIwMDUsImV4cCI6MjA5MTg1ODAwNX0.Ni6_5rnM4uySGkZBw37ujiiIz9-JC4izvCx2ZVt84F8",
  },
};

export default nextConfig;

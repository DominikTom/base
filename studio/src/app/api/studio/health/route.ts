import { NextResponse } from 'next/server';

/** Diagnostyka konfiguracji (tylko flagi obecności, nigdy wartości). */
export async function GET() {
  return NextResponse.json({
    ok: true,
    env: {
      supabase_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      supabase_anon_key: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      supabase_service_key: Boolean(process.env.SUPABASE_SERVICE_KEY),
      gemini_api_key: Boolean(process.env.GEMINI_API_KEY),
      openai_api_key: Boolean(process.env.OPENAI_API_KEY),
    },
  });
}

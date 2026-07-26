import { after, NextResponse, type NextRequest } from 'next/server';
import { runGeneration } from '@/lib/studio/run-generation';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import type { GenerationRow } from '@/lib/studio/types';

export const maxDuration = 300;

/** Ponawia nieudaną (lub zawieszoną) generację w miejscu — te same ustawienia, ten sam rekord. */
export async function POST(_request: NextRequest, ctx: RouteContext<'/api/studio/generations/[id]/retry'>) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;

  const { data, error } = await auth.supabase
    .from('generations')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) {
    return NextResponse.json({ error: 'Nie znaleziono generacji.' }, { status: 404 });
  }
  const generation = data as GenerationRow;
  if (generation.status === 'done') {
    return NextResponse.json(
      { error: 'Ta generacja już się udała — użyj "Generuj ponownie", aby stworzyć nową.' },
      { status: 400 }
    );
  }

  await auth.supabase
    .from('generations')
    .update({ status: 'pending', error_message: null })
    .eq('id', id);

  // Odpowiadamy od razu — klient polluje status na stronie szczegółów.
  after(async () => {
    await runGeneration(auth.supabase, { ...generation, status: 'pending' });
  });
  return NextResponse.json({
    generation: { ...generation, status: 'pending', error_message: null, image_url: null },
  });
}

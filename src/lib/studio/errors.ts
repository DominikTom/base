import { ImageProviderError } from './providers/types';

/**
 * Mapuje błędy providerów na zrozumiałe polskie komunikaty do UI/toastów.
 */
export function providerErrorToPolish(err: unknown): string {
  if (err instanceof ImageProviderError) {
    switch (err.code) {
      case 'missing_api_key':
        return 'Brak skonfigurowanego klucza API dla tego modelu. Uzupełnij zmienne środowiskowe (GEMINI_API_KEY / OPENAI_API_KEY) w ustawieniach Vercel.';
      case 'rate_limit':
        return 'Model jest chwilowo przeciążony (limit zapytań). Odczekaj minutę i spróbuj ponownie.';
      case 'content_blocked':
        return 'Model odrzucił to zapytanie (filtr treści). Zmień opis lub obrazy referencyjne i spróbuj ponownie.';
      case 'model_not_found':
        return `Model niedostępny pod aktualną nazwą (${err.message}). Nazwę modelu można nadpisać zmienną środowiskową — sprawdź dokumentację dostawcy.`;
      case 'invalid_request':
        return `Nieprawidłowe zapytanie do modelu: ${err.message}`;
      case 'no_image_returned':
        return `Model nie zwrócił obrazu. ${err.message}`;
      default:
        return `Błąd dostawcy modelu: ${err.message}`;
    }
  }
  return err instanceof Error ? err.message : 'Nieznany błąd generacji.';
}

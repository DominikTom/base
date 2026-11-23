/**
 * Wspólne limity uploadu — jedno źródło prawdy dla klienta i serwera
 * (wcześniej zduplikowane w trzech miejscach).
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_UPLOAD_LABEL = '20 MB';

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

/**
 * Walidacja pliku po stronie klienta; zwraca polski komunikat błędu albo null.
 * Komunikat nie zawiera nazwy pliku — wywołujący dodaje ją, gdy ma sens.
 */
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return 'nieobsługiwany format (dozwolone PNG, JPG, WEBP)';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `plik przekracza ${MAX_UPLOAD_LABEL}`;
  }
  return null;
}

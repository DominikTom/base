export interface ImageInput {
  data: Buffer;
  mimeType: string;
}

export interface GenerateParams {
  prompt: string;
  /** Packshot produktu — zawsze pierwszy obraz wejściowy, ma priorytet. */
  packshot: ImageInput;
  /** Obrazy referencyjne (inspiracje). */
  references?: ImageInput[];
  /** Docelowa rozdzielczość (obsługiwana przez Gemini: 1K/2K/4K). */
  imageSize?: '1K' | '2K' | '4K';
  aspectRatio?: string;
}

export interface EditParams {
  prompt: string;
  /** Obraz źródłowy (oryginał). */
  image: ImageInput;
  /**
   * Maska PNG o wymiarach obrazu: obszar do edycji = przezroczysty (alpha 0),
   * reszta nieprzezroczysta. Używana przez modele z natywnym maskowaniem.
   */
  mask?: ImageInput;
  /**
   * Kopia obrazu z naniesioną półprzezroczystą czerwoną maską — technika
   * adnotacji dla modeli bez natywnego maskowania (Gemini).
   */
  annotated?: ImageInput;
  /**
   * Obrazy referencyjne produktów do wstawienia/podmiany w zaznaczonym
   * obszarze (np. packshoty lamp, roślin).
   */
  references?: ImageInput[];
}

export interface ImageResult {
  data: Buffer;
  mimeType: string;
}

export class ImageProviderError extends Error {
  constructor(
    message: string,
    /** Kod do mapowania na polski komunikat w UI. */
    public code:
      | 'missing_api_key'
      | 'rate_limit'
      | 'content_blocked'
      | 'invalid_request'
      | 'model_not_found'
      | 'no_image_returned'
      | 'provider_error',
    public status?: number
  ) {
    super(message);
    this.name = 'ImageProviderError';
  }
}

export interface ImageProvider {
  generate(params: GenerateParams): Promise<ImageResult>;
  edit(params: EditParams): Promise<ImageResult>;
}

import { imageSize } from 'image-size';
import {
  type EditParams,
  type GenerateParams,
  type ImageProvider,
  ImageProviderError,
  type ImageResult,
} from './types';

const OPENAI_IMAGES_EDITS = 'https://api.openai.com/v1/images/edits';

/** Ograniczenia rozdzielczości gpt-image-2 (wymiary /16, proporcje 1:3–3:1). */
const MAX_W = 3840;
const MAX_H = 2160;

function explicitSizeFor(image: { data: Buffer }): string {
  try {
    const dim = imageSize(image.data);
    const w = dim.width ?? 0;
    const h = dim.height ?? 0;
    const ratio = w / h;
    if (
      w > 0 &&
      h > 0 &&
      w % 16 === 0 &&
      h % 16 === 0 &&
      w <= MAX_W &&
      h <= MAX_H &&
      ratio >= 1 / 3 &&
      ratio <= 3
    ) {
      return `${w}x${h}`;
    }
  } catch {
    // nieznany format — model dobierze rozmiar sam
  }
  return 'auto';
}

/**
 * Provider GPT Image 2 — endpoint images/edits z natywnym maskowaniem
 * (mask: PNG, przezroczysty obszar = do edycji, wymiary = wymiary obrazu).
 */
export class OpenAiImageProvider implements ImageProvider {
  constructor(private apiModel: string) {}

  async generate(params: GenerateParams): Promise<ImageResult> {
    // Generacja z packshotem to w praktyce edycja obrazów referencyjnych.
    const form = new FormData();
    form.append('model', this.apiModel);
    form.append('prompt', params.prompt);
    form.append(
      'image[]',
      new Blob([new Uint8Array(params.packshot.data)], { type: params.packshot.mimeType }),
      'packshot.png'
    );
    for (const [i, ref] of (params.references ?? []).entries()) {
      form.append(
        'image[]',
        new Blob([new Uint8Array(ref.data)], { type: ref.mimeType }),
        `reference-${i}.png`
      );
    }
    form.append('size', 'auto');
    form.append('quality', 'high');
    return this.call(form);
  }

  async edit(params: EditParams): Promise<ImageResult> {
    if (!params.mask) {
      throw new ImageProviderError('GPT Image edit requires a mask', 'invalid_request');
    }
    const form = new FormData();
    form.append('model', this.apiModel);
    form.append('prompt', params.prompt);
    form.append(
      'image[]',
      new Blob([new Uint8Array(params.image.data)], { type: params.image.mimeType }),
      'image.png'
    );
    // Maska działa na pierwszym obrazie; kolejne obrazy służą jako referencje
    // produktów do wstawienia w edytowany obszar.
    for (const [i, ref] of (params.references ?? []).entries()) {
      form.append(
        'image[]',
        new Blob([new Uint8Array(ref.data)], { type: ref.mimeType }),
        `reference-${i}.png`
      );
    }
    form.append(
      'mask',
      new Blob([new Uint8Array(params.mask.data)], { type: 'image/png' }),
      'mask.png'
    );
    form.append('size', explicitSizeFor(params.image));
    form.append('quality', 'high');
    return this.call(form);
  }

  private async call(form: FormData): Promise<ImageResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ImageProviderError('OPENAI_API_KEY is not configured', 'missing_api_key');
    }

    let res: Response;
    try {
      res = await fetch(OPENAI_IMAGES_EDITS, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } catch (err) {
      throw new ImageProviderError(`OpenAI network error: ${String(err)}`, 'provider_error');
    }

    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{ b64_json?: string }>;
      error?: { message?: string; code?: string; type?: string };
    };

    if (!res.ok) {
      const message = json.error?.message ?? `OpenAI HTTP ${res.status}`;
      if (res.status === 429) throw new ImageProviderError(message, 'rate_limit', 429);
      if (res.status === 404 || json.error?.code === 'model_not_found') {
        throw new ImageProviderError(message, 'model_not_found', res.status);
      }
      if (res.status === 400 && json.error?.type === 'invalid_request_error') {
        throw new ImageProviderError(message, 'invalid_request', 400);
      }
      if (json.error?.code === 'content_policy_violation' || json.error?.code === 'moderation_blocked') {
        throw new ImageProviderError(message, 'content_blocked', res.status);
      }
      throw new ImageProviderError(message, 'provider_error', res.status);
    }

    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      throw new ImageProviderError('OpenAI returned no image data', 'no_image_returned');
    }
    return { data: Buffer.from(b64, 'base64'), mimeType: 'image/png' };
  }
}

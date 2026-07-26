import {
  type EditParams,
  type GenerateParams,
  type ImageProvider,
  ImageProviderError,
  type ImageResult,
} from './types';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

function imagePart(input: { data: Buffer; mimeType: string }): GeminiPart {
  return { inline_data: { mime_type: input.mimeType, data: input.data.toString('base64') } };
}

/**
 * Provider modeli Gemini (Nano Banana Pro / Nano Banana 2).
 * Generacja i edycja przez generateContent z obrazami inline; edycja techniką
 * adnotacji (czerwona maska na kopii obrazu), bo Gemini nie przyjmuje natywnej maski.
 */
export class GeminiImageProvider implements ImageProvider {
  constructor(private apiModel: string) {}

  async generate(params: GenerateParams): Promise<ImageResult> {
    const parts: GeminiPart[] = [
      imagePart(params.packshot),
      ...(params.references ?? []).map(imagePart),
      { text: params.prompt },
    ];
    return this.call(parts, params.imageSize, params.aspectRatio);
  }

  async edit(params: EditParams): Promise<ImageResult> {
    if (!params.annotated) {
      throw new ImageProviderError(
        'Gemini edit requires an annotated image (red-mask technique)',
        'invalid_request'
      );
    }
    const parts: GeminiPart[] = [
      imagePart(params.image),
      imagePart(params.annotated),
      { text: params.prompt },
    ];
    return this.call(parts);
  }

  private async call(
    parts: GeminiPart[],
    imageSize?: '1K' | '2K' | '4K',
    aspectRatio?: string
  ): Promise<ImageResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ImageProviderError('GEMINI_API_KEY is not configured', 'missing_api_key');
    }

    const imageConfig: Record<string, string> = {};
    if (imageSize) imageConfig.imageSize = imageSize;
    if (aspectRatio) imageConfig.aspectRatio = aspectRatio;

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
      },
    };

    let res: Response;
    try {
      res = await fetch(`${GEMINI_BASE}/${this.apiModel}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ImageProviderError(`Gemini network error: ${String(err)}`, 'provider_error');
    }

    const json = (await res.json().catch(() => ({}))) as GeminiResponse;

    if (!res.ok) {
      const message = json.error?.message ?? `Gemini HTTP ${res.status}`;
      if (res.status === 429) throw new ImageProviderError(message, 'rate_limit', 429);
      if (res.status === 404) throw new ImageProviderError(message, 'model_not_found', 404);
      if (res.status === 400) throw new ImageProviderError(message, 'invalid_request', 400);
      throw new ImageProviderError(message, 'provider_error', res.status);
    }

    if (json.promptFeedback?.blockReason) {
      throw new ImageProviderError(
        `Prompt blocked: ${json.promptFeedback.blockReason}`,
        'content_blocked'
      );
    }

    const responseParts = json.candidates?.[0]?.content?.parts ?? [];
    for (const part of responseParts) {
      const inline = part.inlineData ?? part.inline_data;
      if (inline?.data) {
        return {
          data: Buffer.from(inline.data, 'base64'),
          mimeType:
            (part.inlineData?.mimeType ?? part.inline_data?.mime_type) || 'image/png',
        };
      }
    }

    const textParts = responseParts
      .map((p) => p.text)
      .filter(Boolean)
      .join(' ')
      .slice(0, 300);
    throw new ImageProviderError(
      `Gemini returned no image${textParts ? ` (model said: ${textParts})` : ''} (finishReason: ${json.candidates?.[0]?.finishReason ?? 'unknown'})`,
      'no_image_returned'
    );
  }
}

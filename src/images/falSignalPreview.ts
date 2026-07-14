import type { SnapshotSignal, SnapshotSignalPreviewImage } from "../snapshots/sourceSnapshotSchema.js";
import { buildSignalPreviewPrompt } from "../prompts/signalPreviewImage.js";

export const PREVIEW_IMAGE_SIGNAL_KINDS = new Set<SnapshotSignal["kind"]>([
  "idea",
  "pain",
  "risk",
  "hypothesis",
  "insight",
  "trend",
  "event",
  "material",
  "tool",
  "place",
]);

type FalSubmitResponse = {
  request_id?: string;
  status_url?: string;
  response_url?: string;
};

type FalStatusResponse = {
  status?: string;
  error?: unknown;
};

type FalImage = {
  url?: string;
  width?: number;
  height?: number;
  content_type?: string;
};

type FalResultResponse = {
  images?: FalImage[];
};

export type GenerateSignalPreviewOptions = {
  chatTitle?: string;
  model?: string;
  imageSize?: string;
  outputFormat?: string;
  maxPolls?: number;
  pollIntervalMs?: number;
};

export function canGenerateSignalPreview(signal: SnapshotSignal) {
  return PREVIEW_IMAGE_SIGNAL_KINDS.has(signal.kind);
}

function requiredFalKey() {
  const key = process.env.FAL_KEY?.trim();

  if (!key) {
    throw new Error("Missing required environment variable: FAL_KEY.");
  }

  return key;
}

function falModel(options?: GenerateSignalPreviewOptions) {
  return options?.model?.trim() || process.env.FAL_PREVIEW_MODEL?.trim() || "fal-ai/flux-1/schnell";
}

function falImageSize(options?: GenerateSignalPreviewOptions) {
  return options?.imageSize?.trim() || process.env.FAL_PREVIEW_IMAGE_SIZE?.trim() || "landscape_4_3";
}

function falOutputFormat(options?: GenerateSignalPreviewOptions) {
  return options?.outputFormat?.trim() || process.env.FAL_PREVIEW_OUTPUT_FORMAT?.trim() || "jpeg";
}

async function parseFalJson<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${label} failed ${response.status}: ${text}`);
  }

  return JSON.parse(text) as T;
}

export async function generateSignalPreviewImage(
  signal: SnapshotSignal,
  options?: GenerateSignalPreviewOptions,
): Promise<SnapshotSignalPreviewImage> {
  if (!canGenerateSignalPreview(signal)) {
    throw new Error(`Preview image generation is disabled for signal kind: ${signal.kind}.`);
  }

  const key = requiredFalKey();
  const model = falModel(options);
  const prompt = buildSignalPreviewPrompt(signal, options);
  const endpoint = `https://queue.fal.run/${model}`;

  const submitted = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_size: falImageSize(options),
      num_images: 1,
      output_format: falOutputFormat(options),
    }),
  });

  const job = await parseFalJson<FalSubmitResponse>(submitted, "fal submit");

  if (!job.status_url || !job.response_url) {
    throw new Error(`fal submit response is missing status_url or response_url for request ${job.request_id ?? "unknown"}.`);
  }

  const maxPolls = options?.maxPolls ?? 36;
  const pollIntervalMs = options?.pollIntervalMs ?? 2500;

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const statusResponse = await fetch(job.status_url, {
      headers: {
        Authorization: `Key ${key}`,
      },
    });
    const status = await parseFalJson<FalStatusResponse>(statusResponse, "fal status");

    if (status.status === "FAILED") {
      throw new Error(`fal generation failed for request ${job.request_id ?? "unknown"}: ${JSON.stringify(status.error ?? status)}`);
    }

    if (status.status !== "COMPLETED") {
      continue;
    }

    const resultResponse = await fetch(job.response_url, {
      headers: {
        Authorization: `Key ${key}`,
      },
    });
    const result = await parseFalJson<FalResultResponse>(resultResponse, "fal response");
    const image = result.images?.[0];

    if (!image?.url) {
      throw new Error(`fal response is missing image URL for request ${job.request_id ?? "unknown"}.`);
    }

    return {
      provider: "fal.ai",
      model,
      url: image.url,
      width: image.width,
      height: image.height,
      contentType: image.content_type,
      generatedAt: new Date().toISOString(),
      prompt,
      requestId: job.request_id,
    };
  }

  throw new Error(`fal generation timed out for request ${job.request_id ?? "unknown"}.`);
}

import type { ChannelSnapshotDocument, SnapshotGeneratedImage } from "../snapshots/sourceSnapshotSchema.js";

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

export type GenerateSnapshotCoverOptions = {
  model?: string;
  imageSize?: string;
  outputFormat?: string;
  maxPolls?: number;
  pollIntervalMs?: number;
};

function requiredFalKey() {
  const key = process.env.FAL_KEY?.trim();

  if (!key) {
    throw new Error("Missing required environment variable: FAL_KEY.");
  }

  return key;
}

function falModel(options?: GenerateSnapshotCoverOptions) {
  return options?.model?.trim() || process.env.FAL_SNAPSHOT_COVER_MODEL?.trim() || process.env.FAL_PREVIEW_MODEL?.trim() || "fal-ai/flux-1/schnell";
}

function falImageSize(options?: GenerateSnapshotCoverOptions) {
  return options?.imageSize?.trim() || process.env.FAL_SNAPSHOT_COVER_IMAGE_SIZE?.trim() || "landscape_16_9";
}

function falOutputFormat(options?: GenerateSnapshotCoverOptions) {
  return options?.outputFormat?.trim() || process.env.FAL_SNAPSHOT_COVER_OUTPUT_FORMAT?.trim() || process.env.FAL_PREVIEW_OUTPUT_FORMAT?.trim() || "jpeg";
}

function stripMarkdown(value: string | undefined) {
  return (value ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function topSignals(snapshot: ChannelSnapshotDocument) {
  return snapshot.signals
    .filter((signal) => signal.kind !== "person")
    .slice(0, 12)
    .map((signal) => `${signal.kind}: ${stripMarkdown(signal.title)} — ${stripMarkdown(signal.summary).slice(0, 180)}`)
    .join("\n");
}

function hasLiteralNatureWords(value: string) {
  return /\b(baobab|baobabs|tree|trees|forest|savanna|jungle|bird|birds|wildlife|animal|animals|plant|plants|grass|landscape|frozen landscape|winter sky)\b/i.test(value);
}

function usableHeroPrompt(value: string) {
  return hasLiteralNatureWords(value) ? "" : value;
}

export function buildSnapshotCoverPrompt(snapshot: ChannelSnapshotDocument) {
  const heroPrompt = usableHeroPrompt(stripMarkdown(snapshot.heroTheme?.imagePrompt));
  const rawTheme = snapshot.heroTheme
    ? `Theme: ${snapshot.heroTheme.concept}. Mood: ${snapshot.heroTheme.mood}. Palette family: ${snapshot.heroTheme.palette}. Motif: ${snapshot.heroTheme.motif}.`
    : "";
  const theme = hasLiteralNatureWords(rawTheme)
    ? "Theme: abstract strategic growth map for IT consulting, CRM, content operations, productivity, and client confidence. Use a premium studio composition with modular objects, light, paper, metal, glass, and subtle network structure."
    : rawTheme;
  const tags = [...new Set(snapshot.signals.flatMap((signal) => signal.tags).map(stripMarkdown).filter(Boolean))]
    .slice(0, 18)
    .join(", ");

  return [
    "Create one premium editorial hero cover image for a public mini-app snapshot of a Telegram channel.",
    "The image is a wide website header background, not a small icon.",
    "No text, no letters, no logos, no UI, no screenshots, no readable documents, no captions, no charts with labels, no portraits.",
    "Use a concrete visual metaphor built from unmarked objects, space, light, material texture, and composition.",
    "It should feel specific to this channel snapshot, analytical, useful, modern, and sellable.",
    "Leave calm negative space on the left side for white overlaid title text.",
    "Do not illustrate the channel title literally. Treat the title as metadata only, not as an image subject.",
    "No birds, wildlife, animals, trees, plants, grass, forests, savanna, landscapes, or decorative nature scenes.",
    "Prefer business, IT, consulting, product, CRM, content, productivity, and strategic-growth visual metaphors when those topics appear in the signals.",
    "Visual subject: abstract business and technology signal map, client confidence, multi-directional growth, operational clarity.",
    theme,
    heroPrompt ? `Existing visual direction: ${heroPrompt}.` : "",
    tags ? `Important topic tags: ${tags}.` : "",
    "Important signals:",
    topSignals(snapshot),
  ].filter(Boolean).join("\n");
}

async function parseFalJson<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${label} failed ${response.status}: ${text}`);
  }

  return JSON.parse(text) as T;
}

export async function generateSnapshotCoverImage(
  snapshot: ChannelSnapshotDocument,
  options?: GenerateSnapshotCoverOptions,
): Promise<SnapshotGeneratedImage> {
  const key = requiredFalKey();
  const model = falModel(options);
  const prompt = buildSnapshotCoverPrompt(snapshot);
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

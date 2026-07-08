import type { SnapshotSignal, SnapshotSignalPreviewImage } from "../snapshots/sourceSnapshotSchema.js";

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

function stripMarkdown(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableIndex(value: string, modulo: number) {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash % modulo;
}

function visualRecipe(signal: SnapshotSignal) {
  const palettes = [
    "deep emerald, warm ivory, graphite",
    "cobalt blue, paper white, muted coral",
    "charcoal, electric cyan, soft amber",
    "forest green, clay red, pale linen",
    "ink black, acid lime, cool silver",
    "midnight blue, apricot, mist gray",
  ];
  const materials = [
    "cut paper collage with subtle grain",
    "macro product photography of symbolic objects",
    "editorial 3D clay render",
    "risograph-inspired flat illustration",
    "cinematic still life with hard side light",
    "architectural miniature scene",
  ];
  const compositions = [
    "single object centered with large negative space",
    "diagonal tension between two contrasting objects",
    "three unlabeled sculptural objects arranged on a plain surface",
    "tiny human-scale scene inside a large object",
    "split foreground and background with one clear focal metaphor",
    "close-up texture with a small symbolic accent",
  ];
  const kindMetaphors: Record<SnapshotSignal["kind"], string> = {
    idea: "new concept, spark, prototype, switch, seed, blueprint",
    pain: "friction, bottleneck, tangled wire, cracked surface, blocked path",
    risk: "fragile bridge, warning signal, exposed edge, protective barrier, unstable stack, storm boundary",
    hypothesis: "experiment without measuring instruments, branching roots, forked path, two unmarked vessels, contrasting natural samples",
    insight: "revealed pattern, prism, opened box, lens, highlighted trace",
    trend: "rising contour, repeated pattern, directional flow, seasonal layers, shifting tide, growth rings",
    event: "milestone object, opened gate, calendar-like rhythm without text, meeting point, completed step, marked path",
    material: "book, video frame, article clipping, bookmark, study note",
    tool: "instrument, control panel, lever, precise device, workshop object",
    place: "location mood, map pin, weather, landmark fragment, path",
    person: "human presence without portrait likeness, avatar token, conversation signal",
  };
  const fingerprint = [
    `palette: ${palettes[stableIndex(`${signal.id}:palette`, palettes.length)]}`,
    `medium: ${materials[stableIndex(`${signal.id}:material`, materials.length)]}`,
    `composition: ${compositions[stableIndex(`${signal.id}:composition`, compositions.length)]}`,
    `metaphor family: ${kindMetaphors[signal.kind]}`,
  ];

  return fingerprint.join(". ");
}

function titleAnchors(signal: SnapshotSignal) {
  const source = [signal.title, signal.summary, signal.tags.join(" ")].join(" ");
  const words = stripMarkdown(source)
    .split(/\s+/)
    .map((word) => word.replace(/[.,:;!?()[\]"'«»]/g, "").trim())
    .filter((word) => word.length >= 4)
    .filter((word) => !/^(это|как|для|или|если|что|при|над|надо|через|вместо|может|нужно)$/i.test(word));

  return [...new Set(words)].slice(0, 10).join(", ");
}

export function buildSignalPreviewPrompt(signal: SnapshotSignal, options?: GenerateSignalPreviewOptions) {
  const channelLine = options?.chatTitle ? `Channel context: ${stripMarkdown(options.chatTitle)}.` : "";
  const tags = signal.tags.length ? `Tags: ${signal.tags.map(stripMarkdown).join(", ")}.` : "";

  return [
    "Create one unique editorial thumbnail for a Telegram mini-app signal card.",
    "No text, no letters, no logos, no UI screenshots.",
    "Do not include papers, documents, notebooks, screens, maps, labels, handwriting, captions, diagrams, or any text-like marks.",
    "Use only unmarked objects, natural textures, simple shapes, light, shadows, and symbolic scenes.",
    "Avoid generic glowing networks, brains, dashboards, floating spheres, repeated abstract waves, and stock tech backgrounds.",
    "The image must look materially different from other signal thumbnails in the same app.",
    "Use a concrete visual metaphor, not a generic abstract icon.",
    `Visual recipe: ${visualRecipe(signal)}.`,
    `Concrete anchors to inspire objects and scene: ${titleAnchors(signal)}.`,
    `Signal type: ${signal.kind}.`,
    `Title: ${stripMarkdown(signal.title)}.`,
    `Meaning: ${stripMarkdown(signal.summary)}.`,
    tags,
    channelLine,
  ].filter(Boolean).join(" ");
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

import type { SnapshotSignal } from "../snapshots/sourceSnapshotSchema.js";
import { loadPromptMarkdown, renderPromptTemplate } from "./loader.js";

export type SignalPreviewPromptOptions = {
  chatTitle?: string;
};

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

export function buildSignalPreviewPrompt(signal: SnapshotSignal, options?: SignalPreviewPromptOptions) {
  const channelLine = options?.chatTitle ? `Channel context: ${stripMarkdown(options.chatTitle)}.` : "";
  const tags = signal.tags.length ? `Tags: ${signal.tags.map(stripMarkdown).join(", ")}.` : "";

  return renderPromptTemplate(loadPromptMarkdown("images/signal-preview-image.md"), {
    visualRecipe: visualRecipe(signal),
    titleAnchors: titleAnchors(signal),
    signalKind: signal.kind,
    title: stripMarkdown(signal.title),
    summary: stripMarkdown(signal.summary),
    tags,
    channelLine,
  });
}

import type { ChannelSnapshotDocument } from "../snapshots/sourceSnapshotSchema.js";
import { loadPromptMarkdown, renderPromptTemplate } from "./loader.js";

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

  return renderPromptTemplate(loadPromptMarkdown("images/snapshot-cover-image.md"), {
    theme,
    heroPrompt: heroPrompt ? `Existing visual direction: ${heroPrompt}.` : "",
    tags: tags ? `Important topic tags: ${tags}.` : "",
    topSignals: topSignals(snapshot),
  });
}

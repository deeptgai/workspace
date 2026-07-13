import type { ChannelSnapshotSectionId, SnapshotSignalKind } from "./sourceSnapshotSchema.ts";

export type SignalSectionDefinition = {
  kind: SnapshotSignalKind;
  sectionId: ChannelSnapshotSectionId;
  label: string;
  title: string;
};

export const signalSectionDefinitions = [
  { kind: "idea", sectionId: "ideas", label: "Идеи", title: "Раздел Идеи" },
  { kind: "pain", sectionId: "pains", label: "Боли", title: "Раздел Боли" },
  { kind: "risk", sectionId: "risks", label: "Риски", title: "Раздел Риски" },
  { kind: "hypothesis", sectionId: "hypotheses", label: "Гипотезы", title: "Раздел Гипотезы" },
  { kind: "insight", sectionId: "insights", label: "Инсайты", title: "Раздел Инсайты" },
  { kind: "trend", sectionId: "trends", label: "Тренды", title: "Раздел Тренды" },
  { kind: "event", sectionId: "events", label: "События", title: "Раздел События" },
  { kind: "material", sectionId: "materials", label: "Материалы", title: "Раздел Материалы" },
  { kind: "tool", sectionId: "tools", label: "Инструменты", title: "Раздел Инструменты" },
  { kind: "place", sectionId: "places", label: "Места", title: "Раздел Места" },
  { kind: "person", sectionId: "people", label: "Люди", title: "Раздел Люди" },
] as const satisfies readonly SignalSectionDefinition[];

export const signalKinds = signalSectionDefinitions.map((section) => section.kind);
export const signalSectionIds = signalSectionDefinitions.map((section) => section.sectionId);

const signalKindsSet = new Set<SnapshotSignalKind>(signalKinds);
const signalSectionIdsSet = new Set<ChannelSnapshotSectionId>(signalSectionIds);
const definitionByKind = new Map(signalSectionDefinitions.map((section) => [section.kind, section]));
const definitionBySectionId = new Map(signalSectionDefinitions.map((section) => [section.sectionId, section]));

export function isSnapshotSignalKind(value: string): value is SnapshotSignalKind {
  return signalKindsSet.has(value as SnapshotSignalKind);
}

export function isSignalSectionId(value: string): value is ChannelSnapshotSectionId {
  return signalSectionIdsSet.has(value as ChannelSnapshotSectionId);
}

export function signalSectionForKind(kind: SnapshotSignalKind) {
  return definitionByKind.get(kind);
}

export function signalSectionForSectionId(sectionId: ChannelSnapshotSectionId) {
  return definitionBySectionId.get(sectionId);
}

export function sectionIdForSignalKind(kind: SnapshotSignalKind) {
  return signalSectionForKind(kind)?.sectionId;
}

export function signalKindForSectionId(sectionId: ChannelSnapshotSectionId) {
  return signalSectionForSectionId(sectionId)?.kind;
}

export function signalLabelForKind(kind: SnapshotSignalKind) {
  return signalSectionForKind(kind)?.label ?? kind;
}

import type { SnapshotSignal } from "./sourceSnapshotSchema.js";

function signalTimestamp(signal: SnapshotSignal) {
  const value = signal.timeline?.lastEvidenceAt ??
    signal.timeline?.firstEvidenceAt ??
    signal.timeline?.firstPostAt ??
    signal.timeline?.firstCommentAt;

  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function compareSignalsDescending(a: SnapshotSignal, b: SnapshotSignal) {
  const dateDiff = signalTimestamp(b) - signalTimestamp(a);

  if (dateDiff !== 0) {
    return dateDiff;
  }

  return a.title.localeCompare(b.title, "ru") || a.id.localeCompare(b.id, "ru");
}

export function sortSignalsDescending<T extends SnapshotSignal>(signals: T[]) {
  return [...signals].sort(compareSignalsDescending);
}

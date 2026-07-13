import type { SnapshotSignalKind } from "../snapshots/sourceSnapshotSchema.ts";
import { isSnapshotSignalKind, signalKinds } from "../snapshots/signalSections.ts";

export type SourcePaidSignalConfig = {
  paidSignalKinds?: string[] | null;
};

export function normalizePaidSignalKinds(values: Iterable<unknown>): SnapshotSignalKind[] {
  const selected = new Set<SnapshotSignalKind>();

  for (const value of values) {
    if (typeof value !== "string" || !isSnapshotSignalKind(value)) {
      continue;
    }

    selected.add(value);
  }

  return signalKinds.filter((kind) => selected.has(kind));
}

export function sourcePaidSignalKinds(source: SourcePaidSignalConfig | null | undefined): SnapshotSignalKind[] {
  return normalizePaidSignalKinds(source?.paidSignalKinds ?? []);
}

export function isSourceSignalKindPaid(source: SourcePaidSignalConfig | null | undefined, kind: SnapshotSignalKind) {
  return sourcePaidSignalKinds(source).includes(kind);
}

import type { ChannelSnapshotDocument, SnapshotSignalKind } from "../../src/snapshots/sourceSnapshotSchema";
import type { getSnapshotEvidenceMessages } from "../snapshots/snapshotViewData";

export function publicSnapshotDocument(document: ChannelSnapshotDocument, paidSignalKinds: SnapshotSignalKind[] = []) {
  const paidSignalKindSet = new Set(paidSignalKinds);

  return {
    ...document,
    signals: document.signals.filter((signal) => !paidSignalKindSet.has(signal.kind)),
  };
}

export function lockedPaidTabCounts(document: ChannelSnapshotDocument, paidSignalKinds: SnapshotSignalKind[] = []) {
  return Object.fromEntries(
    paidSignalKinds.map((kind) => [kind, document.signals.filter((signal) => signal.kind === kind).length]),
  ) as Partial<Record<SnapshotSignalKind, number>>;
}

export function evidenceForSnapshot(document: ChannelSnapshotDocument, evidenceMessages: ReturnType<typeof getSnapshotEvidenceMessages>) {
  const evidenceIds = new Set(document.signals.flatMap((signal) => signal.evidence?.map((item) => item.itemId) ?? []));

  return evidenceMessages.filter((message) => evidenceIds.has(message.externalId));
}

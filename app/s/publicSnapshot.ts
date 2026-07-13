import type { ChannelSnapshotDocument, SnapshotSignalKind } from "../../src/snapshots/sourceSnapshotSchema";
import type { getSnapshotEvidenceMessages } from "../snapshots/snapshotViewData";

const paidSignalKinds = new Set<SnapshotSignalKind>(["person", "tool"]);

export function publicSnapshotDocument(document: ChannelSnapshotDocument) {
  return {
    ...document,
    signals: document.signals.filter((signal) => !paidSignalKinds.has(signal.kind)),
  };
}

export function lockedPaidTabCounts(document: ChannelSnapshotDocument) {
  return {
    person: document.signals.filter((signal) => signal.kind === "person").length,
    tool: document.signals.filter((signal) => signal.kind === "tool").length,
  };
}

export function evidenceForSnapshot(document: ChannelSnapshotDocument, evidenceMessages: ReturnType<typeof getSnapshotEvidenceMessages>) {
  const evidenceIds = new Set(document.signals.flatMap((signal) => signal.evidence?.map((item) => item.itemId) ?? []));

  return evidenceMessages.filter((message) => evidenceIds.has(message.externalId));
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SnapshotEvidenceRef, SnapshotSignal } from "../../../src/snapshots/sourceSnapshotSchema";

type UseActiveSignalRouteArgs = {
  initialActiveSignalId?: string | null;
  signals: SnapshotSignal[];
  snapshotPath: string;
};

function uniqueEvidence(evidence: SnapshotEvidenceRef[] | undefined) {
  const seen = new Set<string>();
  return (evidence ?? []).filter((item) => {
    if (seen.has(item.itemId)) return false;
    seen.add(item.itemId);
    return true;
  });
}

export function useActiveSignalRoute({ initialActiveSignalId, signals, snapshotPath }: UseActiveSignalRouteArgs) {
  const signalHref = useCallback(
    (signalId: string) => `${snapshotPath}/${encodeURIComponent(signalId)}`,
    [snapshotPath],
  );
  const routeActiveSignalId = useMemo(
    () => initialActiveSignalId && signals.some((signal) => signal.id === initialActiveSignalId)
      ? initialActiveSignalId
      : null,
    [initialActiveSignalId, signals],
  );
  const [activeSignalId, setActiveSignalId] = useState<string | null>(() => routeActiveSignalId);
  const [activeEvidenceItemId, setActiveEvidenceItemId] = useState<string | null>(null);
  const activeSignal = activeSignalId ? signals.find((signal) => signal.id === activeSignalId) ?? null : null;
  const activeSignalEvidence = useMemo(() => uniqueEvidence(activeSignal?.evidence), [activeSignal]);
  const signalIdFromPath = useCallback((path: string) => {
    const signalPathPrefix = `${snapshotPath}/`;

    if (!path.startsWith(signalPathPrefix)) {
      return null;
    }

    const encodedSignalId = path.slice(signalPathPrefix.length).split("/")[0];

    try {
      const decodedSignalId = decodeURIComponent(encodedSignalId);

      return signals.some((signal) => signal.id === decodedSignalId) ? decodedSignalId : null;
    } catch {
      return signals.some((signal) => signal.id === encodedSignalId) ? encodedSignalId : null;
    }
  }, [signals, snapshotPath]);
  const openSignal = useCallback((signal: SnapshotSignal, evidence?: SnapshotEvidenceRef) => {
    setActiveSignalId(signal.id);
    setActiveEvidenceItemId(evidence?.itemId ?? null);
    window.history.pushState({ signalId: signal.id }, "", signalHref(signal.id));
  }, [signalHref]);
  const closeSignal = useCallback(() => {
    setActiveSignalId(null);
    setActiveEvidenceItemId(null);
    window.history.replaceState({}, "", snapshotPath);
  }, [snapshotPath]);

  useEffect(() => {
    setActiveSignalId(routeActiveSignalId);
    setActiveEvidenceItemId(null);
  }, [routeActiveSignalId]);

  useEffect(() => {
    const syncSignalFromLocation = () => {
      setActiveSignalId(signalIdFromPath(window.location.pathname));
      setActiveEvidenceItemId(null);
    };

    window.addEventListener("popstate", syncSignalFromLocation);

    return () => window.removeEventListener("popstate", syncSignalFromLocation);
  }, [signalIdFromPath]);

  return {
    activeEvidenceItemId,
    activeSignal,
    activeSignalEvidence,
    closeSignal,
    openSignal,
    setActiveEvidenceItemId,
    signalHref,
  };
}

"use client";

import { useCallback, useMemo } from "react";
import type { SnapshotSignal, SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import { signalTabs } from "./snapshotSignalPresentation";
import type { PaidTab } from "./snapshotTypes";

type UseSnapshotMenuStateArgs = {
  activeTab: SnapshotSignalKind | "all";
  feedCountsByKind: Partial<Record<SnapshotSignalKind | "all", number>>;
  feedEnabled: boolean;
  feedRefreshing: boolean;
  lockedPaidTabCounts?: Partial<Record<SnapshotSignalKind, number>>;
  paidTabs: PaidTab[];
  signals: SnapshotSignal[];
  timeFilteredAccessibleSignals: SnapshotSignal[];
};

export function useSnapshotMenuState({
  activeTab,
  feedCountsByKind,
  feedEnabled,
  feedRefreshing,
  lockedPaidTabCounts,
  paidTabs,
  signals,
  timeFilteredAccessibleSignals,
}: UseSnapshotMenuStateArgs) {
  const paidTabSet = useMemo(() => new Set<SnapshotSignalKind>(paidTabs), [paidTabs]);
  const sectionCount = useCallback((tabId: SnapshotSignalKind | "all") => {
    if (feedEnabled) {
      return feedCountsByKind[tabId] ?? 0;
    }

    if (tabId === "all") {
      return timeFilteredAccessibleSignals.length;
    }

    if (paidTabSet.has(tabId)) {
      const paidTab = tabId as PaidTab;
      const loadedPaidSignals = signals.filter((signal) => signal.kind === paidTab);

      if (!loadedPaidSignals.length && lockedPaidTabCounts?.[paidTab]) {
        return lockedPaidTabCounts[paidTab] ?? 0;
      }

      return timeFilteredAccessibleSignals.filter((signal) => signal.kind === tabId).length;
    }

    return timeFilteredAccessibleSignals.filter((signal) => signal.kind === tabId).length;
  }, [feedCountsByKind, feedEnabled, lockedPaidTabCounts, paidTabSet, signals, timeFilteredAccessibleSignals]);
  const visibleSignalTabs = useMemo(() => (
    signalTabs
      .map((tab) => ({
        ...tab,
        count: sectionCount(tab.id),
      }))
      .filter((tab) => tab.count > 0 || (tab.id === activeTab && tab.id !== "all"))
  ), [activeTab, sectionCount]);
  const menuLoading = feedEnabled && feedRefreshing && !visibleSignalTabs.length;
  const activeTabLabel = signalTabs.find((tab) => tab.id === activeTab)?.label ?? "Разделы";

  return {
    activeTabLabel,
    menuLoading,
    sectionCount,
    visibleSignalTabs,
  };
}

"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import { paidTabs, type PaidTab, type PaidTabAccess } from "./snapshotTypes";

type UsePaidTabAccessRefreshArgs = {
  activeTab: SnapshotSignalKind | "all";
  checkPaidTabAccess: (tab: PaidTab) => Promise<boolean>;
  paidTabAccess: Record<PaidTab, PaidTabAccess>;
  sectionCount: (tab: SnapshotSignalKind | "all") => number;
  setPaidAccess: (tab: PaidTab, access: PaidTabAccess) => void;
};

function isPaidTab(tab: SnapshotSignalKind | "all"): tab is PaidTab {
  return tab === "person" || tab === "tool";
}

export function usePaidTabAccessRefresh({
  activeTab,
  checkPaidTabAccess,
  paidTabAccess,
  sectionCount,
  setPaidAccess,
}: UsePaidTabAccessRefreshArgs) {
  const checkedTabsRef = useRef<Partial<Record<PaidTab, boolean>>>({});
  const inFlightTabsRef = useRef<Partial<Record<PaidTab, boolean>>>({});

  const refreshPaidTabAccess = useCallback((tab: PaidTab, options: { force?: boolean } = {}) => {
    if (
      sectionCount(tab) <= 0 ||
      paidTabAccess[tab] === "unlocked" ||
      paidTabAccess[tab] === "paying" ||
      inFlightTabsRef.current[tab] ||
      (!options.force && checkedTabsRef.current[tab])
    ) {
      return;
    }

    checkedTabsRef.current[tab] = true;
    inFlightTabsRef.current[tab] = true;

    if (paidTabAccess[tab] !== "checking") {
      setPaidAccess(tab, "checking");
    }

    checkPaidTabAccess(tab)
      .catch(() => {
        setPaidAccess(tab, "locked");
      })
      .finally(() => {
        inFlightTabsRef.current[tab] = false;
      });
  }, [checkPaidTabAccess, paidTabAccess, sectionCount, setPaidAccess]);

  useEffect(() => {
    if (isPaidTab(activeTab)) {
      refreshPaidTabAccess(activeTab);
      return;
    }

    if (activeTab === "all") {
      for (const paidTab of paidTabs) {
        refreshPaidTabAccess(paidTab as PaidTab);
      }
    }
  }, [activeTab, refreshPaidTabAccess]);

  useEffect(() => {
    const refreshVisiblePaidTab = () => {
      if (document.visibilityState !== "visible" || !isPaidTab(activeTab)) {
        return;
      }

      refreshPaidTabAccess(activeTab, { force: true });
    };

    window.addEventListener("focus", refreshVisiblePaidTab);
    window.addEventListener("pageshow", refreshVisiblePaidTab);
    document.addEventListener("visibilitychange", refreshVisiblePaidTab);

    return () => {
      window.removeEventListener("focus", refreshVisiblePaidTab);
      window.removeEventListener("pageshow", refreshVisiblePaidTab);
      document.removeEventListener("visibilitychange", refreshVisiblePaidTab);
    };
  }, [activeTab, refreshPaidTabAccess]);

  return refreshPaidTabAccess;
}

"use client";

import { useCallback, useEffect, useState } from "react";
import type { SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import type { SnapshotFeedLoadedQuery } from "./useSnapshotFeedState";

type UseSnapshotFiltersArgs = {
  feedEnabled: boolean;
  feedLoadedQuery: SnapshotFeedLoadedQuery;
  feedRefreshing: boolean;
  onCloseMenu: () => void;
};

export function useSnapshotFilters({
  feedEnabled,
  feedLoadedQuery,
  feedRefreshing,
  onCloseMenu,
}: UseSnapshotFiltersArgs) {
  const [activeTab, setActiveTab] = useState<SnapshotSignalKind | "all">("all");
  const [selectedTag, setSelectedTag] = useState("");
  const [pendingContentTab, setPendingContentTab] = useState<SnapshotSignalKind | "all" | null>(null);
  const [pendingContentTag, setPendingContentTag] = useState<string | null>(null);
  const sectionQueryPending = feedEnabled &&
    pendingContentTab !== null &&
    pendingContentTab !== feedLoadedQuery.activeTab;
  const contentActiveTab = sectionQueryPending || (feedEnabled && feedRefreshing && activeTab !== feedLoadedQuery.activeTab)
    ? feedLoadedQuery.activeTab
    : activeTab;
  const sectionQueryLoading = sectionQueryPending || (feedEnabled && feedRefreshing && feedLoadedQuery.activeTab !== activeTab);
  const tagQueryPending = feedEnabled &&
    pendingContentTag !== null &&
    pendingContentTag !== feedLoadedQuery.selectedTag;
  const contentSelectedTag = tagQueryPending || (feedEnabled && feedRefreshing)
    ? feedLoadedQuery.selectedTag
    : selectedTag;
  const selectTabUnlocked = useCallback((tab: SnapshotSignalKind | "all") => {
    if (feedEnabled && tab !== feedLoadedQuery.activeTab) {
      setPendingContentTab(tab);
    } else {
      setPendingContentTab(null);
    }

    setActiveTab(tab);
    setSelectedTag("");
    setPendingContentTag(null);
    onCloseMenu();
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }, [feedEnabled, feedLoadedQuery.activeTab, onCloseMenu]);
  const selectTab = useCallback((tab: SnapshotSignalKind | "all") => {
    selectTabUnlocked(tab);
  }, [selectTabUnlocked]);
  const selectTag = useCallback((tag: string) => {
    if (feedEnabled && tag !== feedLoadedQuery.selectedTag) {
      setPendingContentTag(tag);
    } else {
      setPendingContentTag(null);
    }

    setSelectedTag(tag);
  }, [feedEnabled, feedLoadedQuery.selectedTag]);
  const clearSelectedTag = useCallback(() => {
    setPendingContentTag(null);
    setSelectedTag("");
  }, []);

  useEffect(() => {
    if (pendingContentTab !== null && pendingContentTab === feedLoadedQuery.activeTab) {
      setPendingContentTab(null);
    }
  }, [feedLoadedQuery.activeTab, pendingContentTab]);

  useEffect(() => {
    if (pendingContentTag !== null && pendingContentTag === feedLoadedQuery.selectedTag) {
      setPendingContentTag(null);
    }
  }, [feedLoadedQuery.selectedTag, pendingContentTag]);

  return {
    activeTab,
    clearSelectedTag,
    contentActiveTab,
    contentSelectedTag,
    sectionQueryLoading,
    selectTab,
    selectTabUnlocked,
    selectedTag,
    selectTag,
    tagQueryPending,
  };
}

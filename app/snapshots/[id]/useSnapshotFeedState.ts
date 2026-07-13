"use client";

import { useCallback, useRef, useState } from "react";
import type { ChannelSnapshotDocument, SnapshotSignal, SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import type { EvidenceMessage, SignalFeedConfig } from "./snapshotTypes";

type FeedQueryArgs = {
  activeTab: SnapshotSignalKind | "all";
  effectiveTimelineStartDay: number | null;
  onError: (message: string) => void;
  selectedTag: string;
  signal?: AbortSignal;
};

type UseSnapshotFeedStateArgs = {
  evidenceMessages: EvidenceMessage[];
  signalFeed?: SignalFeedConfig;
  snapshot: ChannelSnapshotDocument;
};

export type SnapshotFeedLoadedQuery = {
  activeTab: SnapshotSignalKind | "all";
  effectiveTimelineStartDay: number | null;
  selectedTag: string;
};

function buildFeedParams({ activeTab, effectiveTimelineStartDay, selectedTag }: Omit<FeedQueryArgs, "onError" | "signal">) {
  const params = new URLSearchParams({
    section: activeTab,
  });

  if (effectiveTimelineStartDay !== null) {
    params.set("fromDay", String(effectiveTimelineStartDay));
  }

  if (selectedTag) {
    params.set("tag", selectedTag);
  }

  return params;
}

function mergeEvidenceMessages(current: EvidenceMessage[], incoming: EvidenceMessage[]) {
  const messagesById = new Map(current.map((message) => [message.externalId, message]));

  for (const message of incoming) {
    messagesById.set(message.externalId, message);
  }

  return [...messagesById.values()];
}

function sameFeedQuery(left: SnapshotFeedLoadedQuery, right: SnapshotFeedLoadedQuery) {
  return left.activeTab === right.activeTab &&
    left.effectiveTimelineStartDay === right.effectiveTimelineStartDay &&
    left.selectedTag === right.selectedTag;
}

export function useSnapshotFeedState({ evidenceMessages, signalFeed, snapshot }: UseSnapshotFeedStateArgs) {
  const feedEnabled = Boolean(signalFeed);
  const feedGenerationRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);
  const [feedBootstrapped, setFeedBootstrapped] = useState(() => !feedEnabled);
  const [feedBootstrapPending, setFeedBootstrapPending] = useState(() => feedEnabled);
  const [publicSignals, setPublicSignals] = useState<SnapshotSignal[]>(() => feedEnabled ? [] : snapshot.signals);
  const [publicEvidenceMessages, setPublicEvidenceMessages] = useState<EvidenceMessage[]>(() => feedEnabled ? [] : evidenceMessages);
  const [feedBaseCountsByKind, setFeedBaseCountsByKind] = useState<Partial<Record<SnapshotSignalKind | "all", number>>>({});
  const [feedCountsByKind, setFeedCountsByKind] = useState<Partial<Record<SnapshotSignalKind | "all", number>>>({});
  const [feedTags, setFeedTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [feedNextCursor, setFeedNextCursor] = useState<number | null>(null);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedTotal, setFeedTotal] = useState(() => feedEnabled ? 0 : snapshot.signals.length);
  const [feedTimelineBounds, setFeedTimelineBounds] = useState<{ min: number; max: number } | null>(null);
  const [feedTimelineMarkers, setFeedTimelineMarkers] = useState<Array<{
    id: string;
    kind: SnapshotSignalKind;
    day: number;
    tags: string[];
  }>>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedRefreshing, setFeedRefreshing] = useState(() => feedEnabled);
  const [feedLoadedQuery, setFeedLoadedQuery] = useState<SnapshotFeedLoadedQuery>({
    activeTab: "all",
    effectiveTimelineStartDay: null,
    selectedTag: "",
  });
  const loadFirstPage = useCallback(async ({ activeTab, effectiveTimelineStartDay, onError, selectedTag, signal }: FeedQueryArgs) => {
    if (!signalFeed) {
      return;
    }

    const params = buildFeedParams({ activeTab, effectiveTimelineStartDay, selectedTag });
    params.set("limit", String(signalFeed.limit));
    const loadedQuery = {
      activeTab,
      effectiveTimelineStartDay,
      selectedTag,
    };

    if (feedBootstrapped && sameFeedQuery(feedLoadedQuery, loadedQuery)) {
      return;
    }

    const requestGeneration = feedGenerationRef.current + 1;
    feedGenerationRef.current = requestGeneration;
    const requestIsCurrent = () => feedGenerationRef.current === requestGeneration && !signal?.aborted;

    setFeedLoading(true);
    setFeedRefreshing(true);

    try {
      const response = await fetch(`/api/s/${encodeURIComponent(signalFeed.slug)}/signals?${params.toString()}`, {
        signal,
      });
      const payload = await response.json();

      if (!requestIsCurrent()) {
        return;
      }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Не удалось загрузить сигналы.");
      }

      setPublicSignals(payload.signals ?? []);
      setPublicEvidenceMessages(payload.evidenceMessages ?? []);
      setFeedBaseCountsByKind(payload.baseCountsByKind ?? payload.countsByKind ?? {});
      setFeedCountsByKind(payload.countsByKind ?? {});
      setFeedTags(payload.tags ?? []);
      setFeedNextCursor(payload.nextCursor ?? null);
      setFeedHasMore(Boolean(payload.hasMore));
      setFeedTotal(Number(payload.total ?? 0));
      setFeedTimelineBounds(payload.timelineBounds ?? null);
      setFeedTimelineMarkers(payload.timelineMarkers ?? []);
      setFeedLoadedQuery(loadedQuery);
      setFeedBootstrapped(true);
      setFeedBootstrapPending(false);
    } catch (error) {
      if (!requestIsCurrent() || (error instanceof Error && error.name === "AbortError")) {
        return;
      }

      setFeedBootstrapped(true);
      setFeedBootstrapPending(false);
      onError(error instanceof Error ? error.message : "Не удалось загрузить сигналы.");
    } finally {
      if (requestIsCurrent()) {
        setFeedLoading(false);
        setFeedRefreshing(false);
      }
    }
  }, [feedBootstrapped, feedLoadedQuery, signalFeed]);
  const loadMore = useCallback(async ({ activeTab, effectiveTimelineStartDay, onError, selectedTag }: FeedQueryArgs) => {
    if (!signalFeed || feedLoading || loadMoreInFlightRef.current || feedNextCursor === null) {
      return;
    }

    const requestGeneration = feedGenerationRef.current;
    const params = buildFeedParams({ activeTab, effectiveTimelineStartDay, selectedTag });
    params.set("cursor", String(feedNextCursor));
    params.set("limit", String(signalFeed.limit));

    loadMoreInFlightRef.current = true;
    setFeedLoading(true);

    try {
      const response = await fetch(`/api/s/${encodeURIComponent(signalFeed.slug)}/signals?${params.toString()}`);
      const payload = await response.json();

      if (feedGenerationRef.current !== requestGeneration) {
        return;
      }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Не удалось загрузить сигналы.");
      }

      setPublicSignals((current) => [...current, ...(payload.signals ?? [])]);
      setPublicEvidenceMessages((current) => mergeEvidenceMessages(current, payload.evidenceMessages ?? []));
      setFeedNextCursor(payload.nextCursor ?? null);
      setFeedHasMore(Boolean(payload.hasMore));
      setFeedTotal((current) => Number(payload.total ?? current));
    } catch (error) {
      if (feedGenerationRef.current !== requestGeneration) {
        return;
      }

      onError(error instanceof Error ? error.message : "Не удалось загрузить сигналы.");
    } finally {
      if (feedGenerationRef.current === requestGeneration) {
        setFeedLoading(false);
      }
      loadMoreInFlightRef.current = false;
    }
  }, [feedLoading, feedNextCursor, signalFeed]);

  return {
    feedBaseCountsByKind,
    feedCountsByKind,
    feedEnabled,
    feedHasMore,
    feedBootstrapPending,
    feedLoadedQuery,
    feedLoading,
    feedRefreshing,
    feedTags,
    feedTimelineBounds,
    feedTimelineMarkers,
    feedTotal,
    loadFirstPage,
    loadMore,
    publicEvidenceMessages,
    publicSignals,
  };
}

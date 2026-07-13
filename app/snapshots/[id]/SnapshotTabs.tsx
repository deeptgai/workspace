"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type {
  SnapshotSignal,
  SnapshotSignalKind,
} from "../../../src/snapshots/sourceSnapshotSchema";
import { sortSignalsDescending } from "../../../src/snapshots/signalOrdering";
import { PaidSectionPaywall } from "./PaidSectionPaywall";
import { SnapshotSignalCardsSkeleton, SnapshotTagFilterSkeleton } from "./SnapshotFeedSkeleton";
import { SnapshotHero } from "./SnapshotHero";
import { SnapshotMobileMenu } from "./SnapshotMobileMenu";
import { SnapshotSignalList } from "./SnapshotSignalList";
import { SnapshotSignalModal } from "./SnapshotSignalModal";
import { SnapshotSignalMenu } from "./SnapshotSignalMenu";
import { SnapshotShellSkeleton } from "./SnapshotShellSkeleton";
import { SnapshotTagFilters } from "./SnapshotTagFilters";
import { SnapshotTimelineFilter } from "./SnapshotTimelineFilter";
import {
  visibleSignalTags,
} from "./snapshotSignalPresentation";
import {
  type EvidenceMessage,
  type PaidTab,
  type SnapshotTabsProps,
} from "./snapshotTypes";
import { useActiveSignalRoute } from "./useActiveSignalRoute";
import { useBodyScrollLock } from "./useBodyScrollLock";
import { useMinimumVisibleFlag, useMinimumVisibleValue } from "./useMinimumVisibleState";
import { usePaidTabAccessRefresh } from "./usePaidTabAccessRefresh";
import { usePaidSections } from "./usePaidSections";
import { useSnapshotFilters } from "./useSnapshotFilters";
import { useSnapshotFeedState } from "./useSnapshotFeedState";
import { useSnapshotMenuState } from "./useSnapshotMenuState";
import { useSnapshotTimeline } from "./useSnapshotTimeline";
import { useTelegramWebApp } from "./useTelegramWebApp";
import { useTelegramRuntime } from "./useTelegramRuntime";

const timelineSpinnerMinVisibleMs = 500;
const sectionSpinnerMinVisibleMs = 450;

function mergeSignalsById(signals: SnapshotSignal[]) {
  const merged = new Map<string, SnapshotSignal>();

  for (const signal of signals) {
    merged.set(signal.id, signal);
  }

  return [...merged.values()];
}

export function SnapshotTabs({ snapshot, evidenceMessages, people, actorname, initialActiveSignalId, initialTelegramUser, basePath, lockedPaidTabCounts, paidSignalKinds = [], signalFeed }: SnapshotTabsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const snapshotPath = basePath ?? pathname;
  const cleanSearchParams = new URLSearchParams(searchParams.toString());
  cleanSearchParams.delete("telegram_login");
  const currentPathWithSearch = `${pathname}${cleanSearchParams.size ? `?${cleanSearchParams.toString()}` : ""}`;
  const telegramLoginUrl = `/auth/telegram?returnTo=${encodeURIComponent(currentPathWithSearch)}`;
  const {
    feedBaseCountsByKind,
    feedBootstrapPending,
    feedCountsByKind,
    feedEnabled,
    feedHasMore,
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
  } = useSnapshotFeedState({ evidenceMessages, signalFeed, snapshot });
  const [menuOpen, setMenuOpen] = useState(false);
  const [paywallSignal, setPaywallSignal] = useState<SnapshotSignal | null>(null);
  const getTelegramWebApp = useTelegramWebApp();
  const telegramRuntime = useTelegramRuntime(getTelegramWebApp);
  const paidTabs = useMemo(() => paidSignalKinds, [paidSignalKinds]);
  const paidTabSet = useMemo(() => new Set(paidTabs), [paidTabs]);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const {
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
  } = useSnapshotFilters({
    feedEnabled,
    feedLoadedQuery,
    feedRefreshing,
    onCloseMenu: closeMenu,
  });
  useBodyScrollLock(menuOpen);
  const {
    checkPaidTabAccess,
    openPaidTabPayment,
    paidEvidenceMessages,
    paidTabAccess,
    paidTabSignals,
    paymentMessage,
    setPaidAccess,
    setPaymentMessage,
  } = usePaidSections({
    getTelegramWebApp,
    initialTelegramUser,
    paidSignalKinds: paidTabs,
    selectTabUnlocked,
    snapshot,
    snapshotPath,
  });
  const loadedSignals = useMemo(
    () => mergeSignalsById([
      ...publicSignals,
      ...Object.values(paidTabSignals).flat(),
    ]),
    [paidTabSignals, publicSignals],
  );
  const signals = useMemo(() => sortSignalsDescending(loadedSignals), [loadedSignals]);
  const mergedEvidenceMessages = useMemo(() => {
    const messagesById = new Map<string, EvidenceMessage>();

    for (const message of [...publicEvidenceMessages, ...paidEvidenceMessages]) {
      messagesById.set(message.externalId, message);
    }
    return [...messagesById.values()];
  }, [paidEvidenceMessages, publicEvidenceMessages]);
  const evidenceById = useMemo(
    () => new Map(mergedEvidenceMessages.map((message) => [message.externalId, message])),
    [mergedEvidenceMessages],
  );
  const accessibleSignals = useMemo(
    () => signals.filter((signal) => {
      if (!paidTabSet.has(signal.kind)) {
        return true;
      }

      return paidTabAccess[signal.kind as PaidTab] === "unlocked";
    }),
    [paidTabAccess, paidTabSet, signals],
  );
  const listTabSignals = useMemo(
    () => {
      if (contentActiveTab === "all") {
        return signals;
      }

      return accessibleSignals.filter((signal) => signal.kind === contentActiveTab);
    },
    [accessibleSignals, contentActiveTab, signals],
  );
  const accessibleSignalsForRoute = useMemo(
    () => sortSignalsDescending(accessibleSignals),
    [accessibleSignals],
  );
  const {
    activeEvidenceItemId,
    activeSignal,
    activeSignalEvidence,
    closeSignal,
    openSignal,
    setActiveEvidenceItemId,
    signalHref,
  } = useActiveSignalRoute({
    initialActiveSignalId,
    signals: accessibleSignalsForRoute,
    snapshotPath,
  });
  const contentActiveTabIsLockedPaid = paidTabSet.has(contentActiveTab as SnapshotSignalKind) &&
    paidTabAccess[contentActiveTab as PaidTab] !== "unlocked";
  const {
    commitTimelineStart,
    displayedTimelineStartDay,
    effectiveTimelineStartDay,
    previewTimelineStart,
    timeFilteredAccessibleSignals,
    timeFilteredSignals,
    timelineBounds,
    timelineProgress,
    timelineSignalDots,
    timelineTicks,
  } = useSnapshotTimeline({
    accessibleSignals,
    activeTab: contentActiveTab,
    activeTabIsLockedPaid: contentActiveTabIsLockedPaid,
    feedEnabled,
    feedTimelineBounds,
    feedTimelineMarkers,
    sourceId: snapshot.sourceId,
    tabSignals: listTabSignals,
    onResetTag: clearSelectedTag,
  });
  const tags = useMemo(() => {
    if (feedEnabled) {
      return feedTags;
    }

    const counts = new Map<string, number>();
    for (const signal of timeFilteredSignals) {
      for (const tag of visibleSignalTags(signal)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
      .slice(0, 12)
      .map(([tag, count]) => ({ tag, count }));
  }, [feedEnabled, feedTags, timeFilteredSignals]);
  const timelineQueryLoading = feedEnabled &&
    feedRefreshing &&
    feedLoadedQuery.effectiveTimelineStartDay !== effectiveTimelineStartDay &&
    !sectionQueryLoading;
  const tagFilterLoading = tagQueryPending || (
    feedEnabled &&
    feedRefreshing &&
    selectedTag !== contentSelectedTag &&
    !sectionQueryLoading &&
    !timelineQueryLoading
  );
  const timelineSpinnerVisible = useMinimumVisibleFlag(timelineQueryLoading, timelineSpinnerMinVisibleMs);
  const sectionLoadingTab = useMinimumVisibleValue<SnapshotSignalKind | "all">(
    sectionQueryLoading ? activeTab : null,
    sectionSpinnerMinVisibleMs,
  );
  const filteredSignals = timeFilteredSignals.filter((signal) => {
    const byTag = !contentSelectedTag || visibleSignalTags(signal).includes(contentSelectedTag);
    return byTag;
  });
  const isSignalLocked = useCallback((signal: SnapshotSignal) => (
    paidTabSet.has(signal.kind) && paidTabAccess[signal.kind as PaidTab] !== "unlocked"
  ), [paidTabAccess, paidTabSet]);
  const openLockedSignal = useCallback((signal: SnapshotSignal) => {
    if (!paidTabSet.has(signal.kind)) {
      return;
    }

    setPaywallSignal(signal);
  }, [paidTabSet]);
  useEffect(() => {
    if (selectedTag && !tags.some((item) => item.tag === selectedTag)) {
      clearSelectedTag();
    }
  }, [clearSelectedTag, selectedTag, tags]);
  useEffect(() => {
    const controller = new AbortController();

    loadFirstPage({
      activeTab,
      effectiveTimelineStartDay,
      onError: setPaymentMessage,
      selectedTag,
      signal: controller.signal,
    });

    return () => controller.abort();
  }, [activeTab, effectiveTimelineStartDay, loadFirstPage, selectedTag]);
  const {
    activeTabLabel,
    menuLoading,
    sectionCount,
    visibleSignalTabs,
  } = useSnapshotMenuState({
    activeTab,
    feedCountsByKind,
    feedEnabled,
    feedRefreshing,
    lockedPaidTabCounts,
    paidTabs,
    signals,
    timeFilteredAccessibleSignals,
  });
  const refreshPaidTabAccess = usePaidTabAccessRefresh({
    activeTab,
    checkPaidTabAccess,
    paidTabs,
    paidTabAccess,
    sectionCount,
    setPaidAccess,
  });
  const activePaidTab = paidTabSet.has(activeTab as SnapshotSignalKind) && paidTabAccess[activeTab as PaidTab] !== "unlocked"
    ? activeTab as PaidTab
    : null;
  const activePaidTabAccess = activePaidTab ? paidTabAccess[activePaidTab] : null;
  const activePaidTabPending = activePaidTabAccess === "checking" || activePaidTabAccess === "paying";
  const activePaidTabCount = activePaidTab
    ? sectionCount(activePaidTab)
    : 0;
  const timelineVisibleCount = activePaidTab ? activePaidTabCount : feedEnabled ? feedTotal : timeFilteredSignals.length;
  const timelineTotalCount = activePaidTab
    ? (feedEnabled ? feedBaseCountsByKind[activePaidTab] ?? activePaidTabCount : activePaidTabCount)
    : feedEnabled
      ? feedBaseCountsByKind[contentActiveTab] ?? feedTotal
      : listTabSignals.length;
  const openPaidTabPaywall = useCallback((tab: PaidTab) => {
    if (paidTabAccess[tab] === "browser") {
      window.location.href = telegramLoginUrl;
      return;
    }

    openPaidTabPayment(tab).catch((error) => {
      setPaidAccess(tab, "error");
      setPaymentMessage(error instanceof Error ? error.message : "Не удалось открыть оплату.");
    });
  }, [openPaidTabPayment, paidTabAccess, setPaidAccess, setPaymentMessage, telegramLoginUrl]);
  const openActivePaidTabPayment = () => {
    if (!activePaidTab) {
      return;
    }

    openPaidTabPaywall(activePaidTab);
  };
  const paywallTab = paywallSignal && paidTabSet.has(paywallSignal.kind)
    ? paywallSignal.kind as PaidTab
    : null;
  useEffect(() => {
    if (!paywallTab) {
      return;
    }

    refreshPaidTabAccess(paywallTab);
  }, [paywallTab, refreshPaidTabAccess]);
  useEffect(() => {
    if (paywallTab && paidTabAccess[paywallTab] === "unlocked") {
      setPaywallSignal(null);
    }
  }, [paidTabAccess, paywallTab]);
  const loadMoreSignals = () => {
    loadMore({
      activeTab,
      effectiveTimelineStartDay,
      onError: setPaymentMessage,
      selectedTag,
    });
  };
  const paywallTabAccess = paywallTab ? paidTabAccess[paywallTab] : null;
  const paywallTabPending = paywallTabAccess === "checking" || paywallTabAccess === "paying";
  const showHero = activeTab === "all" && telegramRuntime === "browser";

  if (feedBootstrapPending) {
    return <SnapshotShellSkeleton />;
  }

  return (
    <>
      <section className="grid items-start gap-4 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="sticky top-4 z-20 hidden rounded-lg border border-slate-200 bg-white/90 p-3 shadow-sm backdrop-blur-xl lg:block">
          <SnapshotSignalMenu
            activeTab={activeTab}
            isLoading={menuLoading}
            loadingTab={sectionLoadingTab}
            navClassName="mt-3 grid grid-cols-1 gap-1.5"
            tabs={visibleSignalTabs}
            onSelect={selectTab}
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-3">
          {showHero ? (
            <SnapshotHero
              actorname={actorname}
              getTelegramWebApp={getTelegramWebApp}
              initialTelegramUser={initialTelegramUser}
              loginUrl={telegramLoginUrl}
              snapshot={snapshot}
            />
          ) : null}

          {timelineBounds && timelineBounds.min < timelineBounds.max && displayedTimelineStartDay !== null ? (
            <SnapshotTimelineFilter
              bounds={timelineBounds}
              displayedStartDay={displayedTimelineStartDay}
              isLoading={timelineSpinnerVisible}
              progress={timelineProgress}
              signalDots={timelineSignalDots}
              ticks={timelineTicks}
              totalCount={timelineTotalCount}
              visibleCount={timelineVisibleCount}
              onCommitStart={commitTimelineStart}
              onPreviewStart={previewTimelineStart}
            />
          ) : null}

          <SnapshotMobileMenu
            activeTab={activeTab}
            activeTabLabel={activeTabLabel}
            isLoading={menuLoading}
            loadingTab={sectionLoadingTab}
            menuOpen={menuOpen}
            tabs={visibleSignalTabs}
            onClose={() => setMenuOpen(false)}
            onOpen={() => setMenuOpen(true)}
            onSelect={selectTab}
          />

          {sectionQueryLoading ? (
            <SnapshotTagFilterSkeleton />
          ) : (
            <SnapshotTagFilters
              animateOnSelect={feedEnabled}
              isFiltering={tagFilterLoading}
              selectedTag={selectedTag}
              tags={tags}
              onSelectTag={selectTag}
            />
          )}

          {paymentMessage ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-black text-amber-900">
              {paymentMessage}
            </div>
          ) : null}

          <section className="motion-safe:animate-[snapshotFadeIn_420ms_ease-out]">
            {activePaidTab ? (
              <PaidSectionPaywall
                access={activePaidTabAccess}
                pending={activePaidTabPending}
                title={activeTabLabel}
                onOpen={openActivePaidTabPayment}
              />
            ) : sectionQueryLoading ? (
              <SnapshotSignalCardsSkeleton />
            ) : (
              <SnapshotSignalList
                activeTab={contentActiveTab}
                animateCards={!feedEnabled}
                feedEnabled={feedEnabled}
                feedHasMore={feedHasMore}
                feedLoading={feedLoading}
                isSignalLocked={isSignalLocked}
                people={people}
                selectedTag={contentSelectedTag}
                signalHref={signalHref}
                signals={filteredSignals}
                onLoadMore={loadMoreSignals}
                onOpenLockedSignal={openLockedSignal}
                onOpenSignal={openSignal}
                onSelectTag={selectTag}
              />
            )}
          </section>
        </div>
      </section>

      {activeSignal ? (
        <SnapshotSignalModal
          activeEvidenceItemId={activeEvidenceItemId}
          actorname={actorname}
          evidence={activeSignalEvidence}
          evidenceById={evidenceById}
          signal={activeSignal}
          onClose={closeSignal}
          onSelectEvidence={setActiveEvidenceItemId}
        />
      ) : null}

      {paywallSignal && paywallTab ? (
        <SnapshotSignalModal
          activeEvidenceItemId={null}
          actorname={actorname}
          evidence={[]}
          evidenceById={evidenceById}
          lockedPaywall={{
            access: paywallTabAccess,
            pending: paywallTabPending,
            onOpen: () => openPaidTabPaywall(paywallTab),
          }}
          signal={paywallSignal}
          onClose={() => setPaywallSignal(null)}
          onSelectEvidence={() => undefined}
        />
      ) : null}
    </>
  );
}

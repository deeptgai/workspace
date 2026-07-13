"use client";

import { Fragment, useEffect, useRef } from "react";
import { CircleX } from "lucide-react";
import type { SnapshotSignal, SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import { SnapshotSignalCard } from "./SnapshotSignalCard";
import { signalYear, type SnapshotPerson } from "./snapshotSignalPresentation";

type SnapshotSignalListProps = {
  activeTab: SnapshotSignalKind | "all";
  animateCards?: boolean;
  feedEnabled: boolean;
  feedHasMore: boolean;
  feedLoading: boolean;
  people: SnapshotPerson[];
  selectedTag: string;
  signals: SnapshotSignal[];
  signalHref: (signalId: string) => string;
  isSignalLocked?: (signal: SnapshotSignal) => boolean;
  onLoadMore: () => void;
  onOpenSignal: (signal: SnapshotSignal) => void;
  onOpenLockedSignal?: (signal: SnapshotSignal) => void;
  onSelectTag: (tag: string) => void;
};

export function SnapshotSignalList({
  activeTab,
  animateCards = true,
  feedEnabled,
  feedHasMore,
  feedLoading,
  people,
  selectedTag,
  signals,
  signalHref,
  isSignalLocked,
  onLoadMore,
  onOpenSignal,
  onOpenLockedSignal,
  onSelectTag,
}: SnapshotSignalListProps) {
  const loadMoreRef = useRef(onLoadMore);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!feedEnabled || !feedHasMore || feedLoading || !sentinel) {
      return;
    }

    const loadMoreWhenVisible = (entries: IntersectionObserverEntry[]) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMoreRef.current();
      }
    };

    const observer = new IntersectionObserver(loadMoreWhenVisible, {
      root: null,
      rootMargin: "360px 0px",
      threshold: 0,
    });

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [feedEnabled, feedHasMore, feedLoading, signals.length]);

  if (!signals.length) {
    return (
      <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-slate-200 bg-white/70 p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-400">
            <CircleX className="h-5 w-5" strokeWidth={2.4} />
          </span>
          <p className="m-0 text-sm font-black text-slate-500">Сигналы не найдены</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {signals.map((signal, index) => {
          const year = signalYear(signal) ?? "Без даты";
          const previousYear = index > 0 ? signalYear(signals[index - 1]) ?? "Без даты" : null;
          const showYearDivider = year !== previousYear;
          const locked = isSignalLocked?.(signal) ?? false;

          return (
            <Fragment key={signal.id}>
              {showYearDivider ? (
                <div className="col-span-full flex items-center gap-3 py-2 first:pt-0" aria-label={`Сигналы за ${year}`}>
                  <span className="h-px flex-1 bg-slate-200" />
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-500 shadow-sm">{year}</span>
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
              ) : null}
              <SnapshotSignalCard
                activeTab={activeTab}
                animateIntro={animateCards}
                href={signalHref(signal.id)}
                index={index}
                locked={locked}
                people={people}
                selectedTag={selectedTag}
                signal={signal}
                onOpen={onOpenSignal}
                onOpenLocked={onOpenLockedSignal}
                onSelectTag={onSelectTag}
              />
            </Fragment>
          );
        })}
      </div>
      {feedEnabled && feedHasMore ? (
        <div className="mt-4 grid min-h-12 place-items-center" ref={sentinelRef} aria-live="polite">
          {feedLoading ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-500 shadow-sm">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" aria-hidden="true" />
              Загружаем
            </span>
          ) : (
            <span className="h-px w-px opacity-0" aria-hidden="true" />
          )}
        </div>
      ) : null}
    </>
  );
}

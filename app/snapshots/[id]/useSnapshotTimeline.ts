"use client";

import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import type { SnapshotSignal, SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import {
  cleanSnapshotText,
  dayMs,
  formatTimelineMonth,
  kindLabels,
  signalDayValue,
} from "./snapshotSignalPresentation";
import { readTimelinePreference, timelinePreferenceKey, writeTimelinePreference } from "./timelinePreference";

type TimelineBounds = {
  min: number;
  max: number;
};

type TimelineMarker = {
  id: string;
  kind: SnapshotSignalKind;
  day: number;
  tags: string[];
};

type UseSnapshotTimelineArgs = {
  accessibleSignals: SnapshotSignal[];
  activeTab: SnapshotSignalKind | "all";
  activeTabIsLockedPaid: boolean;
  feedEnabled: boolean;
  feedTimelineBounds: TimelineBounds | null;
  feedTimelineMarkers: TimelineMarker[];
  sourceId: string;
  tabSignals: SnapshotSignal[];
  onResetTag: () => void;
};

function monthStartDay(date: Date) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / dayMs);
}

function timelineMonthTicks(minDay: number, maxDay: number) {
  const ticks: Array<{ day: number; monthLabel: string; yearLabel: string; isYearStart: boolean; isQuarterStart: boolean }> = [];
  const minDate = new Date(minDay * dayMs);
  const maxDate = new Date(maxDay * dayMs);
  const cursor = new Date(Date.UTC(minDate.getUTCFullYear(), minDate.getUTCMonth(), 1));

  while (cursor.getTime() <= maxDate.getTime()) {
    const day = monthStartDay(cursor);

    if (day >= minDay && day <= maxDay) {
      ticks.push({
        day,
        monthLabel: formatTimelineMonth(day),
        yearLabel: String(cursor.getUTCFullYear()),
        isYearStart: cursor.getUTCMonth() === 0 || ticks.length === 0,
        isQuarterStart: cursor.getUTCMonth() % 3 === 0,
      });
    }

    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return ticks;
}

export function useSnapshotTimeline({
  accessibleSignals,
  activeTab,
  activeTabIsLockedPaid,
  feedEnabled,
  feedTimelineBounds,
  feedTimelineMarkers,
  sourceId,
  tabSignals,
  onResetTag,
}: UseSnapshotTimelineArgs) {
  const timelinePreferenceStorageKey = useMemo(() => timelinePreferenceKey(sourceId), [sourceId]);
  const [timelineStartDay, setTimelineStartDay] = useState<number | null>(() => (
    readTimelinePreference(timelinePreferenceStorageKey)
  ));
  const [timelineDraftStartDay, setTimelineDraftStartDay] = useState<number | null>(() => (
    readTimelinePreference(timelinePreferenceStorageKey)
  ));
  const clientTimelineBounds = useMemo(() => {
    const timelineSourceSignals = activeTabIsLockedPaid && tabSignals.length === 0
      ? accessibleSignals
      : tabSignals;
    const days = timelineSourceSignals
      .map(signalDayValue)
      .filter((day): day is number => day !== null);

    if (!days.length) {
      return null;
    }

    return {
      min: Math.min(...days),
      max: Math.max(...days),
    };
  }, [accessibleSignals, activeTabIsLockedPaid, tabSignals]);
  const timelineBounds = feedEnabled ? feedTimelineBounds ?? clientTimelineBounds : clientTimelineBounds;
  const boundedTimelineStartDay = timelineBounds && timelineStartDay !== null
    ? Math.min(Math.max(timelineStartDay, timelineBounds.min), timelineBounds.max)
    : null;
  const effectiveTimelineStartDay = timelineBounds
    ? boundedTimelineStartDay
    : (feedEnabled ? timelineStartDay : null);
  const displayedTimelineStartDay = timelineBounds
    ? Math.min(Math.max(timelineDraftStartDay ?? effectiveTimelineStartDay ?? timelineBounds.min, timelineBounds.min), timelineBounds.max)
    : null;
  const isTimelineFiltered = Boolean(
    timelineBounds &&
    effectiveTimelineStartDay !== null &&
    effectiveTimelineStartDay > timelineBounds.min,
  );
  const timeFilteredSignals = useMemo(() => {
    if (!timelineBounds || effectiveTimelineStartDay === null) {
      return tabSignals;
    }

    return tabSignals.filter((signal) => {
      const day = signalDayValue(signal);

      if (day === null) {
        return !isTimelineFiltered;
      }

      return day >= effectiveTimelineStartDay;
    });
  }, [effectiveTimelineStartDay, isTimelineFiltered, tabSignals, timelineBounds]);
  const timeFilteredAccessibleSignals = useMemo(() => {
    if (!timelineBounds || effectiveTimelineStartDay === null) {
      return accessibleSignals;
    }

    return accessibleSignals.filter((signal) => {
      const day = signalDayValue(signal);

      if (day === null) {
        return !isTimelineFiltered;
      }

      return day >= effectiveTimelineStartDay;
    });
  }, [accessibleSignals, effectiveTimelineStartDay, isTimelineFiltered, timelineBounds]);

  useLayoutEffect(() => {
    if (!timelineBounds || timelineStartDay !== null) {
      return;
    }

    const savedDay = readTimelinePreference(timelinePreferenceStorageKey);

    if (savedDay !== null) {
      setTimelineStartDay(savedDay);
      setTimelineDraftStartDay(savedDay);
    }
  }, [timelineBounds, timelinePreferenceStorageKey, timelineStartDay]);

  const timelineProgress = timelineBounds && displayedTimelineStartDay !== null
    ? ((displayedTimelineStartDay - timelineBounds.min) / Math.max(timelineBounds.max - timelineBounds.min, 1)) * 100
    : 0;
  const timelineTicks = useMemo(() => {
    if (!timelineBounds) {
      return [];
    }

    return timelineMonthTicks(timelineBounds.min, timelineBounds.max).map((tick) => ({
      ...tick,
      position: ((tick.day - timelineBounds.min) / Math.max(timelineBounds.max - timelineBounds.min, 1)) * 100,
    }));
  }, [timelineBounds]);
  const timelineSignalDots = useMemo(() => {
    if (!timelineBounds) {
      return [];
    }

    const span = Math.max(timelineBounds.max - timelineBounds.min, 1);

    if (feedEnabled) {
      return feedTimelineMarkers
        .filter((marker) => activeTab === "all" || marker.kind === activeTab)
        .map((marker) => {
          if (marker.day < timelineBounds.min || marker.day > timelineBounds.max) {
            return null;
          }

          return {
            id: marker.id,
            kind: marker.kind,
            label: kindLabels[marker.kind],
            position: ((marker.day - timelineBounds.min) / span) * 100,
          };
        })
        .filter((item): item is { id: string; kind: SnapshotSignalKind; label: string; position: number } => item !== null);
    }

    return tabSignals
      .map((signal) => {
        const day = signalDayValue(signal);

        if (day === null || day < timelineBounds.min || day > timelineBounds.max) {
          return null;
        }

        return {
          id: signal.id,
          kind: signal.kind,
          label: `${kindLabels[signal.kind]}: ${cleanSnapshotText(signal.title)}`,
          position: ((day - timelineBounds.min) / span) * 100,
        };
      })
      .filter((item): item is { id: string; kind: SnapshotSignalKind; label: string; position: number } => item !== null);
  }, [activeTab, feedEnabled, feedTimelineMarkers, tabSignals, timelineBounds]);
  const previewTimelineStart = useCallback((value: string) => {
    setTimelineDraftStartDay(Number(value));
  }, []);
  const commitTimelineStart = useCallback((value?: string) => {
    const nextDay = value === undefined ? timelineDraftStartDay : Number(value);

    if (nextDay === null || !Number.isFinite(nextDay)) {
      return;
    }

    setTimelineDraftStartDay(nextDay);

    if (nextDay === timelineStartDay) {
      return;
    }

    setTimelineStartDay(nextDay);
    writeTimelinePreference(timelinePreferenceStorageKey, nextDay);
    onResetTag();
  }, [onResetTag, timelineDraftStartDay, timelinePreferenceStorageKey, timelineStartDay]);

  return {
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
  };
}

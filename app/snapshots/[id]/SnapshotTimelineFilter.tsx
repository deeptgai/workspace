"use client";

import type { CSSProperties } from "react";
import type { SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import { formatTimelineDay, signalKindDotClass } from "./snapshotSignalPresentation";

type TimelineBounds = {
  min: number;
  max: number;
};

export type TimelineTick = {
  day: number;
  monthLabel: string;
  yearLabel: string;
  isYearStart: boolean;
  isQuarterStart: boolean;
  position: number;
};

export type TimelineSignalDot = {
  id: string;
  kind: SnapshotSignalKind;
  label: string;
  position: number;
};

type SnapshotTimelineFilterProps = {
  bounds: TimelineBounds;
  displayedStartDay: number;
  isLoading: boolean;
  progress: number;
  signalDots: TimelineSignalDot[];
  ticks: TimelineTick[];
  totalCount: number;
  visibleCount: number;
  onCommitStart: (value: string) => void;
  onPreviewStart: (value: string) => void;
};

export function SnapshotTimelineFilter({
  bounds,
  displayedStartDay,
  isLoading,
  progress,
  signalDots,
  ticks,
  totalCount,
  visibleCount,
  onCommitStart,
  onPreviewStart,
}: SnapshotTimelineFilterProps) {
  const commitCurrentValue = (element: HTMLInputElement) => {
    onCommitStart(element.value);
  };

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur-xl motion-safe:animate-[snapshotFadeIn_320ms_ease-out]"
      aria-busy={isLoading}
      aria-label="Фильтр по времени"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <b className="block text-xl font-black text-slate-950">{formatTimelineDay(displayedStartDay)}</b>
        </div>
        <div className="flex items-center gap-2 text-xs font-black text-slate-500">
          <span className="rounded-full bg-slate-100 px-2 py-1">{visibleCount} из {totalCount}</span>
        </div>
      </div>
      <div className="relative mt-4">
        <input
          aria-label="Начальная дата сигналов"
          className={`timeline-range w-full cursor-pointer appearance-none ${isLoading ? "timeline-range-loading" : ""}`}
          max={bounds.max}
          min={bounds.min}
          step={1}
          style={{ "--timeline-progress": `${progress}%` } as CSSProperties}
          type="range"
          value={displayedStartDay}
          onBlur={(event) => commitCurrentValue(event.currentTarget)}
          onChange={(event) => onPreviewStart(event.currentTarget.value)}
          onInput={(event) => onPreviewStart(event.currentTarget.value)}
          onKeyUp={(event) => commitCurrentValue(event.currentTarget)}
          onMouseUp={(event) => commitCurrentValue(event.currentTarget)}
          onPointerCancel={(event) => commitCurrentValue(event.currentTarget)}
          onPointerUp={(event) => commitCurrentValue(event.currentTarget)}
          onTouchEnd={(event) => commitCurrentValue(event.currentTarget)}
        />
      </div>
      {ticks.length || signalDots.length ? (
        <div className="relative mx-2 mt-2 h-10" aria-hidden="true">
          {signalDots.map((dot) => (
            <span
              className={`absolute top-0 z-10 block aspect-square -translate-x-1/2 rounded-full border border-white ${signalKindDotClass(dot.kind)}`}
              key={dot.id}
              style={{ left: `${dot.position}%`, width: 6 }}
              title={dot.label}
            />
          ))}
          {ticks.map((tick) => (
            <div
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1"
              key={`${tick.yearLabel}-${tick.monthLabel}-${tick.day}`}
              style={{ left: `${tick.position}%` }}
            >
              <span className={`h-2 w-px ${tick.isYearStart ? "bg-slate-500" : "bg-slate-300"}`} />
              {tick.isYearStart || tick.isQuarterStart ? (
                <span className={`whitespace-nowrap text-[10px] font-black uppercase leading-none ${
                  tick.isYearStart ? "text-slate-600" : "text-slate-400"
                }`}>
                  {tick.isYearStart ? tick.yearLabel : tick.monthLabel}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

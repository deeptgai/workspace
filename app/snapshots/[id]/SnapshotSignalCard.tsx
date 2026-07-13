"use client";

import type { KeyboardEvent } from "react";
import { LockOpen } from "lucide-react";
import type { SnapshotSignal, SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import {
  avatarClass,
  cleanSnapshotText,
  findSignalPerson,
  kindLabels,
  personInitials,
  shouldShowPreviewImage,
  signalKindClass,
  signalTabIcons,
  signalTimelineBadges,
  visibleSignalTags,
  type SnapshotPerson,
} from "./snapshotSignalPresentation";

type SnapshotSignalCardProps = {
  activeTab: SnapshotSignalKind | "all";
  animateIntro?: boolean;
  href: string;
  index: number;
  people: SnapshotPerson[];
  selectedTag: string;
  signal: SnapshotSignal;
  locked?: boolean;
  onOpen: (signal: SnapshotSignal) => void;
  onOpenLocked?: (signal: SnapshotSignal) => void;
  onSelectTag: (tag: string) => void;
};

export function SnapshotSignalCard({
  activeTab,
  animateIntro = true,
  href,
  index,
  people,
  selectedTag,
  signal,
  locked = false,
  onOpen,
  onOpenLocked,
  onSelectTag,
}: SnapshotSignalCardProps) {
  const person = findSignalPerson(signal, people);
  const hasPreviewBackground = shouldShowPreviewImage(signal);
  const timelineBadges = signalTimelineBadges(signal);
  const SignalKindIcon = signalTabIcons[signal.kind];
  const privateContentClassName = locked ? "pointer-events-none blur-[4px] opacity-65" : "";
  const openLocked = () => onOpenLocked?.(signal);
  const interactiveProps = locked
    ? {}
    : {
        role: "button",
        tabIndex: 0,
        onClick: () => onOpen(signal),
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(signal);
          }
        },
      };

  return (
    <article
      className={`group relative flex min-h-[190px] flex-col justify-between overflow-hidden rounded-lg border bg-cover bg-center p-3 shadow-sm transition duration-200 ${
        locked ? "" : "cursor-pointer hover:-translate-y-1 hover:border-emerald-200 hover:shadow-lg"
      } ${
        animateIntro ? "motion-safe:animate-[snapshotFadeIn_320ms_ease-out]" : ""
      } ${
        hasPreviewBackground ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"
      }`}
      {...interactiveProps}
      style={{
        ...(animateIntro ? { animationDelay: `${Math.min(index * 28, 240)}ms` } : {}),
        ...(hasPreviewBackground ? { backgroundImage: `url("${signal.previewImage?.url}")` } : {}),
      }}
    >
      {hasPreviewBackground ? (
        <div className="absolute inset-0 bg-slate-900/64 transition duration-200 group-hover:bg-slate-900/56" />
      ) : null}
      {!locked ? (
        <a className="sr-only" href={href}>
          Открыть сигнал: {cleanSnapshotText(signal.title)}
        </a>
      ) : null}
      <div className="relative z-10">
        <div className="flex min-h-7 items-start justify-between gap-2">
          {activeTab === "all" ? (
            <span className={`${signalKindClass(signal.kind)} inline-flex items-center gap-1.5`}>
              <SignalKindIcon className="h-3.5 w-3.5 flex-none" strokeWidth={2.4} />
              {kindLabels[signal.kind]}
            </span>
          ) : (
            <span />
          )}
          {timelineBadges[0] ? (
            <span className={`flex-none rounded-full px-2 py-1 text-[11px] font-black ring-1 ${
              hasPreviewBackground ? "bg-white/15 text-white/85 ring-white/20" : "bg-slate-50 text-slate-500 ring-slate-200"
            }`}>{timelineBadges[0]}</span>
          ) : null}
        </div>

        <div className={privateContentClassName}>
          {signal.kind === "person" ? (
          <div className="mt-3 flex items-center gap-2">
            {person?.user?.photo ? (
              <img alt="" className="h-11 w-11 flex-none rounded-full object-cover ring-2 ring-white/60" src={person.user.photo} />
            ) : (
              <span className={avatarClass(signal)}>{personInitials(signal, person)}</span>
            )}
            <h3 className={`m-0 text-lg font-black leading-tight ${hasPreviewBackground ? "text-white" : "text-slate-950"}`}>
              {cleanSnapshotText(signal.title)}
            </h3>
          </div>
        ) : (
          <h3 className={`m-0 mt-3 text-lg font-black leading-tight ${hasPreviewBackground ? "text-white" : "text-slate-950"}`}>
            {signal.url && !locked ? (
              <a
                className={`${hasPreviewBackground ? "text-white underline decoration-white/40 hover:text-white" : "text-emerald-800 underline decoration-emerald-800/30 hover:text-emerald-950"} underline-offset-4 transition`}
                href={signal.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                {cleanSnapshotText(signal.title)}
              </a>
            ) : cleanSnapshotText(signal.title)}
          </h3>
          )}

          <p className={`m-0 mt-2 overflow-hidden text-sm leading-6 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] ${
            hasPreviewBackground ? "text-white/85" : "text-slate-600"
          }`}>{cleanSnapshotText(signal.summary)}</p>
        </div>
      </div>

      <div className="relative z-10 mt-2 overflow-hidden">
        <div className="flex flex-nowrap gap-1 pr-8">
          {visibleSignalTags(signal).filter((tag) => tag !== selectedTag).map((tag) => (
            <button
              className={`flex-none cursor-pointer rounded-full border px-2 py-1 text-xs font-black transition ${
                hasPreviewBackground
                  ? "border-white/15 bg-white/10 text-white/80 hover:border-white/40 hover:bg-white/20 hover:text-white"
                  : "border-slate-200 bg-[#f4f0e7] text-slate-500 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
              }`}
              key={tag}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSelectTag(tag);
              }}
            >
              {tag}
            </button>
          ))}
        </div>
        <div className={`pointer-events-none absolute inset-y-0 right-0 w-10 ${
          hasPreviewBackground ? "bg-gradient-to-l from-slate-900/80 to-transparent" : "bg-gradient-to-l from-white to-transparent"
        }`} />
      </div>
      {locked ? (
        <div className="pointer-events-none absolute inset-x-3 top-1/2 z-20 flex -translate-y-1/2 justify-center">
          <button
            className="pointer-events-auto inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/70 bg-white/95 px-4 py-2 text-sm font-black text-slate-900 shadow-xl transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-900"
            type="button"
            onClick={openLocked}
          >
            <LockOpen className="h-4 w-4" strokeWidth={2.4} />
            Открыть
          </button>
        </div>
      ) : null}
    </article>
  );
}

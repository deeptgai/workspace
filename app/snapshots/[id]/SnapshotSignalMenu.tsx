"use client";

import type { SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import { signalMenuBadgeClass, signalTabIcons } from "./snapshotSignalPresentation";

export type SnapshotSignalMenuTab = {
  id: SnapshotSignalKind | "all";
  label: string;
  count: number;
};

type SnapshotSignalMenuProps = {
  activeTab: SnapshotSignalKind | "all";
  emptyMessage?: string;
  isLoading?: boolean;
  loadingTab?: SnapshotSignalKind | "all" | null;
  navClassName: string;
  tabs: SnapshotSignalMenuTab[];
  showTitle?: boolean;
  onSelect: (tab: SnapshotSignalKind | "all") => void;
};

export function SnapshotSignalMenu({
  activeTab,
  emptyMessage = "Сигналов нет",
  isLoading = false,
  loadingTab = null,
  navClassName,
  tabs,
  showTitle = true,
  onSelect,
}: SnapshotSignalMenuProps) {
  return (
    <>
      {showTitle ? (
        <div className="px-1 py-2">
          <b className="block text-lg font-black text-slate-950">Карта сигналов</b>
        </div>
      ) : null}
      {tabs.length ? (
        <nav className={navClassName} aria-label="Разделы сигналов">
          {tabs.map((tab) => {
            const Icon = signalTabIcons[tab.id];
            const loading = loadingTab === tab.id;

            return (
              <button
                aria-busy={loading}
                className={`group relative flex min-h-10 cursor-pointer items-center justify-between gap-2 overflow-hidden rounded-lg border px-3 py-2 text-left text-sm font-black transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 ${
                  activeTab === tab.id ? "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-sm" : "border-transparent text-slate-600"
                } ${loading ? "border-emerald-300 bg-emerald-50 text-emerald-900" : ""}`}
                key={tab.id}
                type="button"
                onClick={() => onSelect(tab.id)}
              >
                {loading ? (
                  <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_0%,rgba(16,185,129,0.12)_42%,rgba(16,185,129,0.28)_50%,rgba(16,185,129,0.12)_58%,transparent_100%)] bg-[length:220%_100%] motion-safe:animate-[snapshotTagLoadingShimmer_900ms_ease-in-out_infinite]" />
                ) : null}
                <span className="relative z-10 flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 flex-none" strokeWidth={2.4} />
                  <span className="truncate">{tab.label}</span>
                </span>
                <span className={`relative z-10 rounded-full px-2 py-0.5 text-xs font-black shadow-sm ${signalMenuBadgeClass(tab.id)}`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </nav>
      ) : isLoading ? (
        <div className="mt-3 grid grid-cols-1 gap-1.5" aria-label="Загружаем разделы сигналов">
          {[0, 1, 2, 3, 4].map((item) => (
            <div
              className="flex min-h-10 items-center justify-between gap-2 overflow-hidden rounded-lg border border-transparent px-3 py-2"
              key={item}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="h-4 w-4 flex-none rounded-full bg-slate-200 motion-safe:animate-pulse" />
                <span className="h-3 w-24 rounded-full bg-slate-200 motion-safe:animate-pulse" />
              </span>
              <span className="h-5 w-8 flex-none rounded-full bg-slate-200 motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm font-black text-slate-500">
          {emptyMessage}
        </div>
      )}
    </>
  );
}

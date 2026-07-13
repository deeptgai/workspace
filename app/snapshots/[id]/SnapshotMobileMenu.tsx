"use client";

import { Menu, X } from "lucide-react";
import type { SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import { SnapshotSignalMenu, type SnapshotSignalMenuTab } from "./SnapshotSignalMenu";
import { signalMenuBadgeClass, signalTabIcons } from "./snapshotSignalPresentation";

type SnapshotMobileMenuProps = {
  activeTab: SnapshotSignalKind | "all";
  activeTabLabel: string;
  isLoading?: boolean;
  loadingTab?: SnapshotSignalKind | "all" | null;
  menuOpen: boolean;
  tabs: SnapshotSignalMenuTab[];
  onClose: () => void;
  onOpen: () => void;
  onSelect: (tab: SnapshotSignalKind | "all") => void;
};

export function SnapshotMobileMenu({
  activeTab,
  activeTabLabel,
  isLoading = false,
  loadingTab = null,
  menuOpen,
  tabs,
  onClose,
  onOpen,
  onSelect,
}: SnapshotMobileMenuProps) {
  if (!isLoading && !tabs.length) {
    return null;
  }

  const activeMenuTab = tabs.find((tab) => tab.id === activeTab) ?? null;
  const buttonLabel = tabs.length ? activeMenuTab?.label ?? activeTabLabel : isLoading ? "Загружаем..." : "Сигналов нет";
  const triggerLabel = activeTab === "all" && buttonLabel === "Все" ? "Все сигналы" : buttonLabel;
  const ButtonIcon = activeTab === "all" ? Menu : signalTabIcons[activeTab];

  return (
    <>
      <div className="lg:hidden">
        <button
          className="inline-flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="mobile-signal-menu"
          onClick={onOpen}
        >
          <span className="flex min-w-0 items-center gap-2">
            <ButtonIcon className="h-5 w-5 flex-none" strokeWidth={2.4} />
            <span className="truncate">{triggerLabel}</span>
          </span>
          {activeMenuTab ? (
            <span className={`flex-none rounded-full px-2 py-0.5 text-xs font-black shadow-sm ${signalMenuBadgeClass(activeMenuTab.id)}`}>
              {activeMenuTab.count}
            </span>
          ) : null}
        </button>
      </div>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="presentation">
          <button
            className="absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-sm"
            type="button"
            aria-label="Закрыть меню"
            onClick={onClose}
          />
          <aside
            id="mobile-signal-menu"
            className="relative grid h-full w-[min(86vw,340px)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-r border-slate-200 bg-white shadow-2xl motion-safe:animate-[snapshotDrawerIn_220ms_ease-out]"
            aria-label="Разделы сигналов"
          >
            <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#f9f6ed] p-3">
              <span className="text-base font-black text-slate-950">Карта сигналов</span>
              <button
                className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-rose-50 hover:text-rose-700"
                type="button"
                aria-label="Закрыть меню"
                onClick={onClose}
              >
                <X size={20} />
              </button>
            </header>
            <div className="min-h-0 overflow-auto p-3">
              <SnapshotSignalMenu
                activeTab={activeTab}
                isLoading={isLoading}
                loadingTab={loadingTab}
                navClassName="grid grid-cols-1 gap-1.5"
                showTitle={false}
                tabs={tabs}
                onSelect={onSelect}
              />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

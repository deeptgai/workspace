"use client";

import { PaidAccessPrompt } from "./PaidAccessPrompt";
import type { PaidTabAccess } from "./snapshotTypes";

type PaidSectionPaywallProps = {
  access: PaidTabAccess | null;
  pending: boolean;
  title: string;
  onOpen: () => void;
};

const mockCards = [
  { height: "min-h-36", title: "w-3/4", lines: ["w-full", "w-10/12", "w-2/3"], tags: ["w-14", "w-20"] },
  { height: "min-h-44", title: "w-2/3", lines: ["w-11/12", "w-full", "w-8/12"], tags: ["w-16", "w-12"] },
  { height: "min-h-40", title: "w-4/5", lines: ["w-full", "w-9/12", "w-11/12"], tags: ["w-12", "w-24"] },
  { height: "min-h-48", title: "w-7/12", lines: ["w-10/12", "w-full", "w-3/4"], tags: ["w-20", "w-14"] },
  { height: "min-h-36", title: "w-5/6", lines: ["w-full", "w-8/12", "w-10/12"], tags: ["w-16", "w-16"] },
  { height: "min-h-44", title: "w-3/5", lines: ["w-11/12", "w-full", "w-7/12"], tags: ["w-12", "w-20"] },
];

export function PaidSectionPaywall({ access, pending, title, onOpen }: PaidSectionPaywallProps) {
  return (
    <div className="relative isolate overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-sm sm:p-4">
      <div
        aria-hidden="true"
        className="absolute inset-3 grid grid-cols-1 gap-3 opacity-75 blur-[1.2px] sm:inset-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {mockCards.map((card, index) => (
          <div
            className={`${card.height} rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm`}
            key={`${card.title}-${index}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className={`h-5 rounded-full bg-slate-300 ${card.title}`} />
              <span className="h-5 w-10 rounded-full bg-emerald-100" />
            </div>
            <div className="mt-5 space-y-2.5">
              {card.lines.map((line, lineIndex) => (
                <span className={`block h-3 rounded-full bg-slate-200 ${line}`} key={`${line}-${lineIndex}`} />
              ))}
            </div>
            <div className="mt-5 flex gap-2">
              {card.tags.map((tag, tagIndex) => (
                <span className={`h-6 rounded-full bg-slate-100 ${tag}`} key={`${tag}-${tagIndex}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="absolute inset-0 bg-white/70 backdrop-blur-[1px]" />
      <div className="relative z-10 flex min-h-[430px] items-start justify-center py-6 sm:min-h-[390px] sm:items-center sm:py-8">
        <PaidAccessPrompt
          access={access}
          actionLabel="Открыть раздел"
          browserActionLabel="Войти через Telegram"
          pending={pending}
          showIcon
          title={title}
          onOpen={onOpen}
        />
      </div>
    </div>
  );
}

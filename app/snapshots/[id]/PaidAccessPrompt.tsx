"use client";

import { Lock, LockOpen } from "lucide-react";
import { PaidAccessBenefits } from "./PaidAccessBenefits";
import type { PaidTabAccess } from "./snapshotTypes";

type PaidAccessPromptProps = {
  access: PaidTabAccess | null;
  actionLabel: string;
  browserActionLabel?: string;
  className?: string;
  pending: boolean;
  showIcon?: boolean;
  title: string;
  onOpen: () => void;
};

export function PaidAccessPrompt({
  access,
  actionLabel,
  browserActionLabel,
  className = "",
  pending,
  showIcon = false,
  title,
  onOpen,
}: PaidAccessPromptProps) {
  const checking = pending && access === "checking";
  const paying = pending && access === "paying";
  const buttonLabel = access === "browser" && browserActionLabel
    ? browserActionLabel
    : paying
      ? "Открываем"
      : actionLabel;

  return (
    <div className={`w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 text-center shadow-xl ${className}`}>
      {checking ? (
        <div aria-busy="true" aria-label="Проверяем доступ">
          {showIcon ? (
            <span className="mx-auto block h-11 w-11 rounded-full bg-slate-200 motion-safe:animate-pulse" />
          ) : null}
          <span className={`mx-auto block h-6 w-44 rounded-full bg-slate-200 motion-safe:animate-pulse ${showIcon ? "mt-3" : ""}`} />
          <div className="mt-5 space-y-2">
            <span className="block h-4 w-full rounded-full bg-slate-100 motion-safe:animate-pulse" />
            <span className="block h-4 w-11/12 rounded-full bg-slate-100 motion-safe:animate-pulse" />
            <span className="block h-4 w-10/12 rounded-full bg-slate-100 motion-safe:animate-pulse" />
          </div>
          <span className="mt-4 block h-11 w-full rounded-lg bg-slate-100 motion-safe:animate-pulse" />
        </div>
      ) : (
        <>
          {showIcon ? (
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-950 text-white">
              <Lock className="h-5 w-5" strokeWidth={2.4} />
            </div>
          ) : null}
          <h2 className={`m-0 text-xl font-black leading-tight text-slate-950 ${showIcon ? "mt-3" : ""}`}>{title}</h2>
          <PaidAccessBenefits className="mt-5" />
          <button
            className="mt-4 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-100 hover:text-emerald-950 disabled:cursor-wait disabled:opacity-75 disabled:hover:translate-y-0 disabled:hover:bg-emerald-50 disabled:hover:text-emerald-800"
            disabled={paying}
            type="button"
            onClick={onOpen}
          >
            {paying ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-800" aria-hidden="true" />
            ) : (
              <LockOpen className="h-4 w-4" strokeWidth={2.4} />
            )}
            {buttonLabel}
          </button>
        </>
      )}
    </div>
  );
}

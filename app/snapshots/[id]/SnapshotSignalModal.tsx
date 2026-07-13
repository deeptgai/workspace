"use client";

import { Fragment, useEffect, useId, useRef, type KeyboardEvent } from "react";
import { ExternalLink, Eye, Gauge, Heart, X } from "lucide-react";
import type { SnapshotEvidenceRef, SnapshotSignal } from "../../../src/snapshots/sourceSnapshotSchema";
import {
  cleanSnapshotText,
  formatDateTime,
  formatInteger,
  formatSignalPeriod,
  kindLabels,
  shouldShowPreviewImage,
  visibleSignalTags,
} from "./snapshotSignalPresentation";
import { PaidAccessPrompt } from "./PaidAccessPrompt";
import type { EvidenceMessage, PaidTabAccess } from "./snapshotTypes";
import { useBodyScrollLock } from "./useBodyScrollLock";

type SnapshotSignalModalProps = {
  activeEvidenceItemId: string | null;
  actorname?: string | null;
  evidence: SnapshotEvidenceRef[];
  evidenceById: Map<string, EvidenceMessage>;
  lockedPaywall?: {
    access: PaidTabAccess | null;
    pending: boolean;
    onOpen: () => void;
  };
  signal: SnapshotSignal;
  onClose: () => void;
  onSelectEvidence: (itemId: string | null) => void;
};

function capitalizeLabel(label: string) {
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : label;
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong className="font-black text-slate-900" key={index}>{part.slice(2, -2)}</strong>;
    }

    return <Fragment key={index}>{part}</Fragment>;
  });
}

function FormattedText({ text }: { text: string }) {
  const blocks: Array<{ type: "paragraph" | "quote" | "list" | "heading"; lines: string[] }> = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let listLines: string[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length) {
      blocks.push({ type: "paragraph", lines: paragraphLines });
      paragraphLines = [];
    }
  };
  const flushList = () => {
    if (listLines.length) {
      blocks.push({ type: "list", lines: listLines });
      listLines = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", lines: [trimmed.replace(/^>\s*/, "")] });
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", lines: [trimmed.replace(/^#{1,3}\s+/, "")] });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      listLines.push(trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""));
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();

  return (
    <div className="space-y-5 whitespace-normal text-[15px] leading-8 text-slate-700">
      {blocks.map((block, index) => {
        if (block.type === "list") {
          return (
            <ul className="m-0 list-disc space-y-2 pl-6 marker:text-slate-900" key={index}>
              {block.lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderInlineMarkdown(line)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "quote") {
          return (
            <blockquote className="m-0 rounded-lg border-l-4 border-emerald-200 bg-emerald-50/70 px-4 py-3 text-emerald-950" key={index}>
              {renderInlineMarkdown(block.lines.join(" "))}
            </blockquote>
          );
        }

        if (block.type === "heading") {
          return (
            <h3 className="m-0 pt-1 text-xl font-black leading-snug text-slate-950" key={index}>
              {renderInlineMarkdown(block.lines.join(" "))}
            </h3>
          );
        }

        return (
          <p className="m-0" key={index}>
            {renderInlineMarkdown(block.lines.join(" "))}
          </p>
        );
      })}
    </div>
  );
}

export function SnapshotSignalModal({
  activeEvidenceItemId,
  actorname,
  evidence,
  evidenceById,
  lockedPaywall,
  signal,
  onClose,
  onSelectEvidence,
}: SnapshotSignalModalProps) {
  useBodyScrollLock();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();

  const activeEvidence = activeEvidenceItemId
    ? evidence.find((item) => item.itemId === activeEvidenceItemId) ?? null
    : null;
  const activeMessage = activeEvidence ? evidenceById.get(activeEvidence.itemId) ?? null : null;
  const sourceItemUrl = activeMessage && actorname
    ? `https://t.me/${actorname}/${activeMessage.externalId}`
    : null;
  const tags = visibleSignalTags(signal);
  const locked = Boolean(lockedPaywall);
  const lockedContentClassName = locked
    ? "pointer-events-none max-h-40 select-none overflow-hidden blur-[4px] opacity-55"
    : "";
  const lockedHeaderClassName = locked
    ? "pointer-events-none select-none blur-[4px] opacity-55"
    : "";
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "textarea:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    )).filter((element) => (
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      !element.closest("[data-focus-disabled='true']")
    ));

    if (!focusable.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid items-start justify-items-center bg-slate-950/45 p-2 pt-2 backdrop-blur-sm sm:place-items-center sm:p-3" role="presentation" onClick={onClose}>
      <aside
        className="grid max-h-[calc(100dvh-1rem)] w-full max-w-[52rem] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl motion-safe:animate-[snapshotFadeIn_220ms_ease-out] sm:max-h-[92vh]"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleDialogKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-[#f9f6ed] p-4">
          <div className={`min-w-0 ${lockedHeaderClassName}`}>
            <h2 className="m-0 text-xl font-black leading-tight text-slate-950 sm:text-2xl" id={titleId}>{cleanSnapshotText(signal.title)}</h2>
            {tags.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span className="rounded-full border border-slate-200 bg-white/80 px-2 py-1 text-xs font-black text-slate-600" key={tag}>{tag}</span>
                ))}
              </div>
            ) : null}
          </div>
          <button
            className="grid h-10 w-10 flex-none cursor-pointer place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-rose-50 hover:text-rose-700"
            ref={closeButtonRef}
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>

        <div className="min-h-0 overflow-auto p-4">
          {lockedPaywall ? (
            <PaidAccessPrompt
              access={lockedPaywall.access}
              actionLabel="Открыть карточку"
              className="mx-auto mb-4 shadow-sm"
              pending={lockedPaywall.pending}
              title="Открыть карточку"
              onOpen={lockedPaywall.onOpen}
            />
          ) : null}

          <div
            aria-hidden={locked}
            className={lockedContentClassName}
            data-focus-disabled={locked ? "true" : undefined}
          >
            <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Содержимое сигнала">
              <button
                className={`min-h-10 flex-none cursor-pointer rounded-lg border px-3 py-2 text-sm font-black transition ${
                  activeEvidenceItemId === null ? "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
                }`}
                type="button"
                role="tab"
                aria-selected={activeEvidenceItemId === null}
                onClick={() => onSelectEvidence(null)}
              >
                {capitalizeLabel(kindLabels[signal.kind])}
              </button>
              {evidence.map((item, index) => {
                const isActive = activeEvidence?.itemId === item.itemId;
                const message = evidenceById.get(item.itemId);
                const evidenceLabel = message?.kind === "comment" ? "Комментарий" : "Пост";
                const evidenceDate = message ? formatSignalPeriod(message.publishedAt) : null;

                return (
                  <button
                    className={`min-h-10 flex-none cursor-pointer rounded-lg border px-3 py-2 text-sm font-black transition ${
                      isActive ? "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
                    }`}
                    key={item.itemId}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => onSelectEvidence(item.itemId)}
                  >
                    {evidenceDate ? `${evidenceLabel} · ${evidenceDate}` : `${evidenceLabel} ${index + 1}`}
                  </button>
                );
              })}
            </div>

            {activeEvidenceItemId === null ? (
              <div>
                <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
                  {shouldShowPreviewImage(signal) ? (
                    <img
                      alt=""
                      className="hidden h-32 w-32 flex-none rounded-lg object-cover shadow-sm ring-1 ring-slate-200 sm:block"
                      src={signal.previewImage?.url}
                    />
                  ) : null}
                  <p className="m-0 text-base leading-7 text-slate-700">{cleanSnapshotText(signal.summary)}</p>
                </div>
                {signal.url ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-black text-sky-700 shadow-sm transition hover:border-sky-300 hover:bg-sky-100 hover:text-sky-900"
                      href={signal.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={15} />
                      Открыть в Telegram
                    </a>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                {activeMessage ? (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-slate-50 px-2 py-1 text-xs font-black text-slate-600">{formatDateTime(activeMessage.publishedAt)}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-xs font-black text-slate-600">
                      <Eye className="h-3.5 w-3.5 text-slate-400" strokeWidth={2.4} />
                      {formatInteger(activeMessage.views)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-xs font-black text-rose-700">
                      <Heart className="h-3.5 w-3.5 text-rose-400" strokeWidth={2.4} />
                      {formatInteger(activeMessage.reactionsTotal)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">
                      <Gauge className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2.4} />
                      {activeMessage.engagementScore.toFixed(2)}
                    </span>
                  </div>
                ) : null}

                {activeEvidence?.reason ? (
                  <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
                    <b className="block text-xs uppercase tracking-[0.12em] text-emerald-800">Почему это важно</b>
                    {cleanSnapshotText(activeEvidence.reason)}
                  </div>
                ) : null}

                {activeMessage ? (
                  <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
                    {activeMessage.formattedText || activeMessage.text ? (
                      <FormattedText text={activeMessage.formattedText || activeMessage.text || ""} />
                    ) : (
                      <p className="m-0 text-[15px] leading-7 text-slate-500">У сообщения нет текстового содержимого.</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center text-slate-500">
                    У этого сигнала нет загруженного поста-подтверждения.
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {sourceItemUrl ? (
                    <a
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-black text-sky-700 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-100 hover:text-sky-900"
                      href={sourceItemUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={15} />
                      Открыть в Telegram
                    </a>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

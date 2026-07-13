"use client";

import { useEffect, useState } from "react";

type SnapshotTagFiltersProps = {
  animateOnSelect?: boolean;
  isFiltering?: boolean;
  selectedTag: string;
  tags: Array<{ tag: string; count: number }>;
  onSelectTag: (tag: string) => void;
};

const tagFilterMinAnimationMs = 450;

export function SnapshotTagFilters({
  animateOnSelect = false,
  isFiltering = false,
  selectedTag,
  tags,
  onSelectTag,
}: SnapshotTagFiltersProps) {
  const [pendingTag, setPendingTag] = useState<string | null>(null);
  const [filterAnimationVisible, setFilterAnimationVisible] = useState(false);

  useEffect(() => {
    if (isFiltering) {
      setFilterAnimationVisible(true);
      return;
    }

    if (!filterAnimationVisible) {
      setPendingTag(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      setFilterAnimationVisible(false);
      setPendingTag(null);
    }, tagFilterMinAnimationMs);

    return () => window.clearTimeout(timeout);
  }, [filterAnimationVisible, isFiltering]);

  if (!tags.length) {
    return null;
  }

  return (
    <section className="motion-safe:animate-[snapshotFadeIn_360ms_ease-out]" aria-label="Фильтры по тегам">
      <div className="relative min-w-0">
        <div
          className="snapshot-tag-filter-scroll flex min-w-0 gap-1.5 overflow-x-auto whitespace-nowrap pr-12 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-wrap lg:overflow-visible lg:whitespace-normal lg:pr-0"
        >
          {tags.map(({ tag, count }) => {
            const selected = selectedTag === tag;
            const loading = filterAnimationVisible && (pendingTag === tag || (!pendingTag && selected));

            return (
              <button
                aria-busy={loading}
                className={`relative inline-flex min-h-10 flex-none cursor-pointer items-center gap-2 overflow-hidden rounded-full border px-3 py-2 text-sm font-black transition duration-200 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 lg:hover:-translate-y-0.5 ${
                  selected ? "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-sm" : "border-slate-200 bg-white text-slate-600"
                } ${loading ? "border-emerald-300 bg-emerald-50 text-emerald-900" : ""}`}
                key={tag}
                type="button"
                onClick={() => {
                  setPendingTag(tag);
                  if (animateOnSelect) {
                    setFilterAnimationVisible(true);
                  }
                  onSelectTag(selected ? "" : tag);
                }}
              >
                {loading ? (
                  <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_0%,rgba(16,185,129,0.16)_42%,rgba(16,185,129,0.34)_50%,rgba(16,185,129,0.16)_58%,transparent_100%)] bg-[length:220%_100%] motion-safe:animate-[snapshotTagLoadingShimmer_900ms_ease-in-out_infinite]" />
                ) : null}
                <span className="relative z-10">{tag}</span>
                <span className={`relative z-10 rounded-full px-2 py-0.5 text-xs ${
                  selected ? "bg-white text-emerald-800" : "bg-slate-100 text-slate-500"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

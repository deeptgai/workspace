"use client";

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <span
      className={`block rounded-full bg-slate-200/80 motion-safe:animate-pulse ${className}`}
      aria-hidden="true"
    />
  );
}

export function SnapshotTagFilterSkeleton() {
  const widths = ["w-24", "w-28", "w-20", "w-32", "w-24", "w-28", "w-20"];

  return (
    <section aria-busy="true" aria-label="Загружаем теги">
      <div className="relative min-w-0">
        <div className="flex min-w-0 gap-1.5 overflow-hidden whitespace-nowrap pr-12 lg:flex-wrap lg:whitespace-normal lg:pr-0">
          {widths.map((width, index) => (
            <SkeletonBlock className={`h-10 flex-none ${width}`} key={`${width}-${index}`} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function SnapshotSignalCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Загружаем сигналы">
      {Array.from({ length: count }).map((_, index) => (
        <article className="min-h-[190px] rounded-lg border border-slate-200 bg-white p-3 shadow-sm" key={index}>
          <div className="flex items-start justify-between gap-2">
            <SkeletonBlock className="h-7 w-20" />
            <SkeletonBlock className="h-7 w-16 bg-slate-100" />
          </div>
          <SkeletonBlock className="mt-5 h-5 w-5/6" />
          <SkeletonBlock className="mt-2 h-5 w-2/3 bg-slate-100" />
          <div className="mt-5 space-y-2">
            <SkeletonBlock className="h-3 w-full bg-slate-100" />
            <SkeletonBlock className="h-3 w-11/12 bg-slate-100" />
            <SkeletonBlock className="h-3 w-4/5 bg-slate-100" />
          </div>
          <div className="mt-5 flex gap-1.5 overflow-hidden">
            <SkeletonBlock className="h-7 w-16 bg-slate-100" />
            <SkeletonBlock className="h-7 w-20 bg-slate-100" />
          </div>
        </article>
      ))}
    </div>
  );
}

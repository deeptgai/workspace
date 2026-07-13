"use client";

function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <span
      className={`block rounded-full bg-slate-200/80 motion-safe:animate-pulse ${className}`}
      aria-hidden="true"
    />
  );
}

export function SnapshotShellSkeleton() {
  const menuRows = Array.from({ length: 11 });
  const cards = Array.from({ length: 6 });

  return (
    <section className="grid items-start gap-4 lg:grid-cols-[248px_minmax(0,1fr)]" aria-busy="true" aria-label="Загрузка карты сигналов">
      <aside className="sticky top-4 z-20 hidden rounded-lg border border-slate-200 bg-white/90 p-3 shadow-sm backdrop-blur-xl lg:block">
        <div className="px-1 py-2">
          <SkeletonLine className="h-5 w-32" />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-1.5">
          {menuRows.map((_, index) => (
            <div className="flex min-h-10 items-center justify-between gap-2 rounded-lg px-3 py-2" key={index}>
              <span className="flex min-w-0 items-center gap-2">
                <SkeletonLine className="h-4 w-4" />
                <SkeletonLine className={`h-4 ${index % 3 === 0 ? "w-20" : index % 3 === 1 ? "w-24" : "w-16"}`} />
              </span>
              <SkeletonLine className="h-5 w-8" />
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur-xl">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <SkeletonLine className="h-6 w-36" />
            </div>
            <SkeletonLine className="h-6 w-16" />
          </div>
          <SkeletonLine className="mt-5 h-3 w-full" />
          <div className="relative mx-2 mt-3 h-8">
            <SkeletonLine className="h-2 w-full" />
          </div>
        </div>

        <div className="lg:hidden">
          <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <span className="flex min-w-0 items-center gap-2">
              <SkeletonLine className="h-5 w-5" />
              <SkeletonLine className="h-4 w-28" />
            </span>
            <SkeletonLine className="h-5 w-8" />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 8 }).map((_, index) => (
            <SkeletonLine className={`h-10 ${index % 3 === 0 ? "w-24" : index % 3 === 1 ? "w-28" : "w-20"}`} key={index} />
          ))}
        </div>

        <section>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((_, index) => (
              <article className="min-h-[190px] rounded-lg border border-slate-200 bg-white p-3 shadow-sm" key={index}>
                <div className="flex items-start justify-between gap-2">
                  <SkeletonLine className="h-7 w-20" />
                  <SkeletonLine className="h-7 w-24" />
                </div>
                <SkeletonLine className="mt-5 h-5 w-5/6" />
                <SkeletonLine className="mt-2 h-5 w-2/3" />
                <div className="mt-5 space-y-2">
                  <SkeletonLine className="h-3 w-full" />
                  <SkeletonLine className="h-3 w-11/12" />
                  <SkeletonLine className="h-3 w-4/5" />
                </div>
                <div className="mt-5 flex gap-1.5 overflow-hidden">
                  <SkeletonLine className="h-7 w-16" />
                  <SkeletonLine className="h-7 w-20" />
                  <SkeletonLine className="h-7 w-14" />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

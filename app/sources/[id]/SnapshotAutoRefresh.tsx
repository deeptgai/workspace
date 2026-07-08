"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function SnapshotAutoRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 4000);

    return () => window.clearInterval(interval);
  }, [enabled, router]);

  return null;
}

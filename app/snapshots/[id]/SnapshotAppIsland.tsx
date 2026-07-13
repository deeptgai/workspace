"use client";

import { useEffect, useState } from "react";
import { SnapshotShellSkeleton } from "./SnapshotShellSkeleton";
import { SnapshotTabs } from "./SnapshotTabs";
import type { SnapshotTabsProps } from "./snapshotTypes";

export function SnapshotAppIsland(props: SnapshotTabsProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <SnapshotShellSkeleton />;
  }

  return <SnapshotTabs {...props} />;
}

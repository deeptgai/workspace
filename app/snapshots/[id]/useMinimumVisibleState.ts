"use client";

import { useEffect, useState } from "react";

export function useMinimumVisibleFlag(active: boolean, minVisibleMs: number) {
  const [visible, setVisible] = useState(active);

  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }

    if (!visible) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setVisible(false);
    }, minVisibleMs);

    return () => window.clearTimeout(timeout);
  }, [active, minVisibleMs, visible]);

  return visible;
}

export function useMinimumVisibleValue<T>(value: T | null, minVisibleMs: number) {
  const [visibleValue, setVisibleValue] = useState<T | null>(value);

  useEffect(() => {
    if (value !== null) {
      setVisibleValue(value);
      return;
    }

    if (visibleValue === null) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setVisibleValue(null);
    }, minVisibleMs);

    return () => window.clearTimeout(timeout);
  }, [minVisibleMs, value, visibleValue]);

  return visibleValue;
}

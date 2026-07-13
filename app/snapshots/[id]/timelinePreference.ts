const timelinePreferencePrefix = "deeptg_timeline_start";

export function timelinePreferenceKey(sourceId: string) {
  return `${timelinePreferencePrefix}_${sourceId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function parseTimelinePreferenceValue(value: string | null | undefined) {
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function readTimelinePreference(key: string) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  try {
    return parseTimelinePreferenceValue(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function writeTimelinePreference(key: string, value: number) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Some embedded browsers can restrict localStorage. The preference is optional.
  }
}

export function normalizeSourceSlugParam(value: string) {
  let normalized = value.trim();

  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(normalized);

      if (decoded === normalized) {
        break;
      }

      normalized = decoded;
    } catch {
      break;
    }
  }

  return normalized.replace(/^@/, "").toLowerCase();
}

export function sourceSlug(title: string) {
  return normalizeSourceSlugParam(title)
    .replace(/@/g, "")
    .replace(/[^a-zа-я0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "source";
}

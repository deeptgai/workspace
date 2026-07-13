export function sourceSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/[^a-zа-я0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "source";
}

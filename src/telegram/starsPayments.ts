import type { ChannelSnapshotSectionId } from "../snapshots/sourceSnapshotSchema.ts";
import { isSignalSectionId, signalSectionForSectionId, signalSectionIds } from "../snapshots/signalSections.ts";

export const PAID_SECTION_IDS = signalSectionIds;
export const DEFAULT_SOURCE_ACCESS_PRICE_USD_CENTS = 1000;
export const DEFAULT_TELEGRAM_STARS_PER_USD = 100;

export type PaidSectionId = ChannelSnapshotSectionId;

export type PaidSectionInvoicePayload = {
  product: string;
  sectionId: PaidSectionId;
  sourceId: string;
  telegramId?: bigint;
  checkoutId?: string;
};

export function isPaidSectionId(value: string): value is PaidSectionId {
  return isSignalSectionId(value);
}

export function paidSectionProduct(sectionId: PaidSectionId) {
  return `${sectionId}-section`;
}

export function paidSectionTitle(sectionId: PaidSectionId) {
  return signalSectionForSectionId(sectionId)?.title ?? "Раздел";
}

export function normalizeSourceAccessPriceUsdCents(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : Number(String(value ?? "").trim().replace(",", "."));

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SOURCE_ACCESS_PRICE_USD_CENTS;
  }

  return Math.round(parsed * 100);
}

export function sourceAccessPriceUsd(sourceAccessPriceUsdCents: number | null | undefined) {
  const cents = sourceAccessPriceUsdCents ?? DEFAULT_SOURCE_ACCESS_PRICE_USD_CENTS;

  return (cents / 100).toFixed(2);
}

export function telegramStarsPerUsd() {
  const value = Number(process.env.TELEGRAM_STARS_PER_USD || DEFAULT_TELEGRAM_STARS_PER_USD);

  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TELEGRAM_STARS_PER_USD;
}

export function sourceAccessPriceStars(sourceAccessPriceUsdCents: number | null | undefined) {
  const cents = sourceAccessPriceUsdCents ?? DEFAULT_SOURCE_ACCESS_PRICE_USD_CENTS;

  return Math.max(1, Math.ceil(cents * telegramStarsPerUsd() / 100));
}

export function makePaidSectionInvoicePayload(input: {
  sectionId: PaidSectionId;
  sourceId: string;
  telegramId?: bigint;
  checkoutId?: string;
}) {
  if (input.telegramId) {
    return `section:${input.sectionId}:${input.sourceId}:user:${input.telegramId.toString()}`;
  }

  if (input.checkoutId) {
    return `section:${input.sectionId}:${input.sourceId}:checkout:${input.checkoutId}`;
  }

  throw new Error("Paid section invoice payload requires telegramId or checkoutId");
}

export function parsePaidSectionInvoicePayload(payload: string): PaidSectionInvoicePayload | null {
  const [namespace, sectionId, sourceId, kind, id] = payload.split(":");

  if (namespace !== "section" || !isPaidSectionId(sectionId) || !sourceId || !kind || !id) {
    return null;
  }

  if (kind === "user" && /^\d+$/.test(id)) {
    return {
      product: paidSectionProduct(sectionId),
      sectionId,
      sourceId,
      telegramId: BigInt(id),
    };
  }

  if (kind === "checkout") {
    return {
      product: paidSectionProduct(sectionId),
      sectionId,
      sourceId,
      checkoutId: id,
    };
  }

  return null;
}

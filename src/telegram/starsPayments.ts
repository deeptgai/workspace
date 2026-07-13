import type { ChannelSnapshotSectionId } from "../snapshots/sourceSnapshotSchema.ts";
import { isSignalSectionId, signalSectionForSectionId, signalSectionIds } from "../snapshots/signalSections.ts";

export const PAID_SECTION_IDS = signalSectionIds;

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

export function paidSectionPriceStars(sectionId: PaidSectionId) {
  const envName = `TELEGRAM_${sectionId.toUpperCase()}_SECTION_PRICE_STARS`;
  const defaultPrice = 1;
  const value = Number(process.env[envName] || defaultPrice);

  return Number.isFinite(value) && value > 0 ? value : defaultPrice;
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
  const [legacySectionId, legacySourceId, legacyTelegramId] = payload.split(":");

  if (
    isPaidSectionId(legacySectionId) &&
    legacySourceId &&
    legacyTelegramId &&
    /^\d+$/.test(legacyTelegramId) &&
    payload.split(":").length === 3
  ) {
    return {
      product: paidSectionProduct(legacySectionId),
      sectionId: legacySectionId,
      sourceId: legacySourceId,
      telegramId: BigInt(legacyTelegramId),
    };
  }

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

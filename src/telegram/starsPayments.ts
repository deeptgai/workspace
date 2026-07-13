export const PAID_SECTION_IDS = ["people", "tools"] as const;

export type PaidSectionId = typeof PAID_SECTION_IDS[number];

export type PaidSectionInvoicePayload = {
  product: string;
  sectionId: PaidSectionId;
  sourceId: string;
  telegramId?: bigint;
  checkoutId?: string;
};

const paidSectionConfig: Record<PaidSectionId, { product: string; title: string; envPrice: string; defaultPrice: number }> = {
  people: {
    product: "people-section",
    title: "Раздел Люди",
    envPrice: "TELEGRAM_PEOPLE_SECTION_PRICE_STARS",
    defaultPrice: 1,
  },
  tools: {
    product: "tools-section",
    title: "Раздел Инструменты",
    envPrice: "TELEGRAM_TOOLS_SECTION_PRICE_STARS",
    defaultPrice: 1,
  },
};

export function isPaidSectionId(value: string): value is PaidSectionId {
  return PAID_SECTION_IDS.includes(value as PaidSectionId);
}

export function paidSectionProduct(sectionId: PaidSectionId) {
  return paidSectionConfig[sectionId].product;
}

export function paidSectionTitle(sectionId: PaidSectionId) {
  return paidSectionConfig[sectionId].title;
}

export function paidSectionPriceStars(sectionId: PaidSectionId) {
  const config = paidSectionConfig[sectionId];
  const value = Number(process.env[config.envPrice] || config.defaultPrice);

  return Number.isFinite(value) && value > 0 ? value : config.defaultPrice;
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

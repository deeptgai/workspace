#!/usr/bin/env node

import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  buildPaidSectionInvoiceRequest,
  createPaidSectionInvoiceLink,
} from "./starsInvoices.ts";
import { isPaidSectionId, makePaidSectionInvoicePayload } from "./starsPayments.ts";

const sectionArg = process.argv[2] || "tools";
const sectionId = isPaidSectionId(sectionArg) ? sectionArg : "tools";
const sourceId = process.env.STARS_TEST_SOURCE_ID || "debug-source";
const sourceTitle = process.env.STARS_TEST_SOURCE_TITLE || "DeepTG test";
const sourceAccessPriceUsdCents = Number(process.env.STARS_TEST_PRICE_USD_CENTS || 1000);
const invoicePayload = makePaidSectionInvoicePayload({
  sectionId,
  sourceId,
  checkoutId: `debug-${randomUUID()}`,
});
const requestBody = buildPaidSectionInvoiceRequest({
  sectionId,
  sourceTitle,
  sourceAccessPriceUsdCents,
  invoicePayload,
});

if (requestBody.provider_token !== "") {
  throw new Error("Stars invoice request must include an empty provider_token for Telegram Stars.");
}

console.log("Stars invoice request body:");
console.log(JSON.stringify(requestBody, null, 2));
console.log("\nOK: provider_token is empty, currency is XTR.");

if (process.env.LIVE === "1") {
  const invoice = await createPaidSectionInvoiceLink({
    sectionId,
    sourceTitle,
    sourceAccessPriceUsdCents,
    invoicePayload,
  });

  console.log("\nLive Telegram invoice:");
  console.log(JSON.stringify(invoice, null, 2));
}

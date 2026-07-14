import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPaidSectionInvoiceRequest, createPaidSectionInvoiceLink, normalizeTelegramInvoiceLink } from "../../src/telegram/starsInvoices.ts";

describe("Telegram Stars invoices", () => {
  it("builds a Stars invoice request with an empty provider token", () => {
    const request = buildPaidSectionInvoiceRequest({
      sectionId: "tools",
      sourceTitle: "DeepTG test",
      sourceAccessPriceUsdCents: 1000,
      invoicePayload: "section:tools:source:user:123",
    });

    assert.equal(request.provider_token, "");
    assert.equal(request.currency, "XTR");
    assert.equal(request.prices.length, 1);
  });

  it("normalizes telegram.me invoice links for Telegram WebApp.openInvoice", () => {
    assert.equal(
      normalizeTelegramInvoiceLink("https://telegram.me/$YXd3Z8a6sUpIFwAAnSTDHzQqD5I"),
      "https://t.me/$YXd3Z8a6sUpIFwAAnSTDHzQqD5I"
    );
  });

  it("accepts t.me invoice links", () => {
    assert.equal(
      normalizeTelegramInvoiceLink("https://t.me/invoice/YXd3Z8a6sUpIFwAAnSTDHzQqD5I"),
      "https://t.me/invoice/YXd3Z8a6sUpIFwAAnSTDHzQqD5I"
    );
  });

  it("rejects links that Telegram WebApp.openInvoice cannot open", () => {
    assert.throws(
      () => normalizeTelegramInvoiceLink("https://t.me/deeptg_bot?start=invoice_123"),
      /unsupported invoice link/
    );
  });

  it("keeps the original invoice link while adding a WebApp-safe link", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: true,
      result: "https://telegram.me/$YXd3Z8a6sUpIFwAAnSTDHzQqD5I",
    })) as unknown as ReturnType<typeof fetch>;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";

    try {
      const invoice = await createPaidSectionInvoiceLink({
        sectionId: "tools",
        sourceTitle: "DeepTG test",
        sourceAccessPriceUsdCents: 1000,
        invoicePayload: "section:tools:source:user:123",
      });

      assert.equal(invoice.invoiceLink, "https://telegram.me/$YXd3Z8a6sUpIFwAAnSTDHzQqD5I");
      assert.equal(invoice.webAppInvoiceLink, "https://t.me/$YXd3Z8a6sUpIFwAAnSTDHzQqD5I");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

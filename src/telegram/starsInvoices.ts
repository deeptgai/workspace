import { sourceAccessPriceStars, paidSectionTitle, type PaidSectionId } from "./starsPayments.ts";

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export type PaidSectionInvoice = {
  invoiceLink: string;
  webAppInvoiceLink: string;
  amount: number;
  currency: "XTR";
};

export type CreatePaidSectionInvoiceInput = {
  sectionId: PaidSectionId;
  sourceTitle: string;
  sourceAccessPriceUsdCents: number;
  invoicePayload: string;
};

export function normalizeTelegramInvoiceLink(invoiceLink: string) {
  const url = new URL(invoiceLink);

  if (url.hostname === "telegram.me") {
    url.hostname = "t.me";
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "t.me" ||
    !/^\/(\$|invoice\/)[A-Za-z0-9\-_=]+$/.test(url.pathname)
  ) {
    throw new Error(`Telegram returned an unsupported invoice link: ${invoiceLink}`);
  }

  return url.toString();
}

export function buildPaidSectionInvoiceRequest(input: CreatePaidSectionInvoiceInput) {
  const title = paidSectionTitle(input.sectionId);
  const amount = sourceAccessPriceStars(input.sourceAccessPriceUsdCents);

  return {
    title,
    description: `Доступ к разделу ${title.replace(/^Раздел\s+/i, "")} для ${input.sourceTitle}`,
    payload: input.invoicePayload,
    provider_token: "",
    currency: "XTR",
    prices: [
      {
        label: title,
        amount,
      },
    ],
  };
}

export async function createPaidSectionInvoiceLink(input: CreatePaidSectionInvoiceInput): Promise<PaidSectionInvoice> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }

  const requestBody = buildPaidSectionInvoiceRequest(input);
  const response = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  const data = (await response.json()) as TelegramResponse<string>;

  if (!response.ok || !data.ok || !data.result) {
    throw new Error(data.description || "Could not create Telegram Stars invoice");
  }

  return {
    invoiceLink: data.result,
    webAppInvoiceLink: normalizeTelegramInvoiceLink(data.result),
    amount: requestBody.prices[0].amount,
    currency: "XTR",
  };
}

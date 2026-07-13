import { paidSectionPriceStars, paidSectionTitle, type PaidSectionId } from "./starsPayments.ts";

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export type PaidSectionInvoice = {
  invoiceLink: string;
  amount: number;
  currency: "XTR";
};

export type CreatePaidSectionInvoiceInput = {
  sectionId: PaidSectionId;
  sourceTitle: string;
  invoicePayload: string;
};

export function buildPaidSectionInvoiceRequest(input: CreatePaidSectionInvoiceInput) {
  const title = paidSectionTitle(input.sectionId);
  const amount = paidSectionPriceStars(input.sectionId);

  return {
    title,
    description: `Доступ к разделу ${title.replace(/^Раздел\s+/i, "")} для ${input.sourceTitle}`,
    payload: input.invoicePayload,
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
    amount: requestBody.prices[0].amount,
    currency: "XTR",
  };
}

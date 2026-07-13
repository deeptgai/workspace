#!/usr/bin/env node

import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { prisma } from "./db/prisma.ts";
import { paidSectionTitle, parsePaidSectionInvoicePayload } from "./telegram/starsPayments.ts";

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type TelegramMessage = {
  message_id: number;
  text?: string;
  from?: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
  successful_payment?: {
    currency: string;
    total_amount: number;
    invoice_payload: string;
    telegram_payment_charge_id: string;
    provider_payment_charge_id: string;
  };
  web_app_data?: {
    data: string;
  };
  chat: {
    id: number;
  };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  pre_checkout_query?: {
    id: string;
    currency: string;
    total_amount: number;
    invoice_payload: string;
    from: {
      id: number;
      is_bot?: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
  };
};

type WebhookInfo = {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
};

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

if (!token) {
  throw new Error("Missing required environment variable: TELEGRAM_BOT_TOKEN");
}

const apiBaseUrl = `https://api.telegram.org/bot${token}`;
const port = Number(process.env.TELEGRAM_WEBHOOK_PORT || "8787");
const path = process.env.TELEGRAM_WEBHOOK_PATH?.trim() || "/telegram/webhook";
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim();
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim();
const miniAppUrl = process.env.TELEGRAM_MINI_APP_URL?.trim();

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("TELEGRAM_WEBHOOK_PORT must be an integer between 1 and 65535.");
}

function normalizePath(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

async function callTelegram<T>(method: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/${method}`, init);
  const payload = (await response.json()) as TelegramResponse<T>;

  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new Error(payload.description || `Telegram API request failed: ${method}`);
  }

  return payload.result;
}

function getMiniAppUrl(): string | undefined {
  return miniAppUrl;
}

async function sendMessage(chatId: number, text: string, options?: { miniAppButton?: boolean }): Promise<void> {
  const webAppUrl = options?.miniAppButton ? getMiniAppUrl() : undefined;

  await callTelegram("sendMessage", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(webAppUrl
        ? {
            reply_markup: {
              inline_keyboard: [[
                {
                  text: "Открыть Mini App",
                  web_app: {
                    url: webAppUrl,
                  },
                },
              ]],
            },
          }
        : {}),
    }),
  });
}

async function setWebhook(url: string): Promise<void> {
  await callTelegram<boolean>("setWebhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url,
      allowed_updates: ["message", "pre_checkout_query"],
      ...(secretToken ? { secret_token: secretToken } : {}),
    }),
  });
}

async function getWebhookInfo(): Promise<WebhookInfo> {
  return callTelegram<WebhookInfo>("getWebhookInfo");
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

async function answerPreCheckoutQuery(id: string, ok: boolean, errorMessage?: string): Promise<void> {
  await callTelegram<boolean>("answerPreCheckoutQuery", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      pre_checkout_query_id: id,
      ok,
      ...(errorMessage ? { error_message: errorMessage } : {}),
    }),
  });
}

async function handlePreCheckoutQuery(query: NonNullable<TelegramUpdate["pre_checkout_query"]>): Promise<void> {
  const payload = parsePaidSectionInvoicePayload(query.invoice_payload);

  if (!payload || query.currency !== "XTR" || (payload.telegramId && payload.telegramId !== BigInt(query.from.id))) {
    await answerPreCheckoutQuery(query.id, false, "Некорректный платеж.");
    return;
  }

  await prisma.telegramUser.upsert({
    where: {
      telegramId: BigInt(query.from.id),
    },
    update: {
      username: query.from.username,
      firstName: query.from.first_name,
      lastName: query.from.last_name,
      languageCode: query.from.language_code,
      rawJson: query.from,
    },
    create: {
      telegramId: BigInt(query.from.id),
      username: query.from.username,
      firstName: query.from.first_name,
      lastName: query.from.last_name,
      languageCode: query.from.language_code,
      rawJson: query.from,
    },
  });

  await answerPreCheckoutQuery(query.id, true);
}

async function handleSuccessfulPayment(message: TelegramMessage): Promise<void> {
  const payment = message.successful_payment;

  if (!payment) {
    return;
  }

  const payload = parsePaidSectionInvoicePayload(payment.invoice_payload);

  if (!payload || payment.currency !== "XTR") {
    return;
  }

  const telegramId = payload.telegramId ?? (message.from?.id ? BigInt(message.from.id) : null);

  if (!telegramId) {
    return;
  }

  const telegramUser = await prisma.telegramUser.upsert({
    where: {
      telegramId,
    },
    update: {
      username: message.from?.username,
      firstName: message.from?.first_name,
      lastName: message.from?.last_name,
      languageCode: message.from?.language_code,
      rawJson: message.from,
    },
    create: {
      telegramId,
      username: message.from?.username,
      firstName: message.from?.first_name,
      lastName: message.from?.last_name,
      languageCode: message.from?.language_code,
      rawJson: message.from,
    },
  });

  const existingPaidPurchase = await prisma.telegramPurchase.findFirst({
    where: {
      telegramId,
      product: payload.product,
      sourceId: payload.sourceId,
      status: "paid",
    },
  });
  const paidPurchaseData = {
    telegramUserId: telegramUser.id,
    status: "paid",
    amount: payment.total_amount,
    telegramPaymentChargeId: payment.telegram_payment_charge_id,
    providerPaymentChargeId: payment.provider_payment_charge_id,
    paidAt: new Date(),
  };
  const paidAccessWhere = {
    telegramId,
    product: payload.product,
    sourceId: payload.sourceId,
  };
  const matchingInvoicePurchase = await prisma.telegramPurchase.findUnique({
    where: {
      invoicePayload: payment.invoice_payload,
    },
  });

  if (existingPaidPurchase) {
    await prisma.telegramPurchase.update({
      where: {
        id: existingPaidPurchase.id,
      },
      data: paidPurchaseData,
    });
  } else if (matchingInvoicePurchase) {
    await prisma.telegramPurchase.update({
      where: {
        id: matchingInvoicePurchase.id,
      },
      data: paidPurchaseData,
    });
  } else {
    await prisma.telegramPurchase.create({
      data: {
        telegramUserId: telegramUser.id,
        telegramId,
        product: payload.product,
        sourceId: payload.sourceId,
        status: "paid",
        amount: payment.total_amount,
        invoicePayload: payment.invoice_payload,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        providerPaymentChargeId: payment.provider_payment_charge_id,
        paidAt: new Date(),
      },
    });
  }

  await prisma.telegramPurchase.deleteMany({
    where: {
      ...paidAccessWhere,
      status: "pending",
    },
  });
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.pre_checkout_query) {
    await handlePreCheckoutQuery(update.pre_checkout_query);
    return;
  }

  const message = update.message;

  if (!message) {
    return;
  }

  if (message.successful_payment) {
    await handleSuccessfulPayment(message);
    const payload = parsePaidSectionInvoicePayload(message.successful_payment.invoice_payload);
    const sectionTitle = payload ? paidSectionTitle(payload.sectionId) : "раздел";
    await sendMessage(message.chat.id, `Оплата прошла. ${sectionTitle} открыт.`);
    return;
  }

  if (message.web_app_data) {
    await sendMessage(message.chat.id, "Данные Mini App получены.");
    return;
  }

  if (!message.text) {
    return;
  }

  await sendMessage(message.chat.id, "Откройте карту сигналов в Mini App.", { miniAppButton: true });
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const webhookPath = normalizePath(path);

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method !== "POST" || requestUrl.pathname !== webhookPath) {
    sendJson(response, 404, { ok: false, error: "Not found" });
    return;
  }

  if (secretToken && request.headers["x-telegram-bot-api-secret-token"] !== secretToken) {
    sendJson(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  const body = await readJsonBody(request);
  await handleUpdate(body as TelegramUpdate);
  sendJson(response, 200, { ok: true });
}

async function run(): Promise<void> {
  const webhookPath = normalizePath(path);
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      sendJson(response, 500, { ok: false });
    });
  });

  server.listen(port, () => {
    console.log(`Telegram webhook bot listening on http://localhost:${port}${webhookPath}`);
  });

  if (webhookUrl) {
    const fullWebhookUrl = new URL(webhookPath, webhookUrl).toString();
    await setWebhook(fullWebhookUrl);

    const info = await getWebhookInfo();
    console.log(`Telegram webhook set to ${info.url}`);
    console.log(`Pending updates: ${info.pending_update_count}`);
    if (info.last_error_message) {
      console.log(`Last webhook error: ${info.last_error_message}`);
    }

    if (miniAppUrl) {
      console.log(`Telegram Mini App URL: ${miniAppUrl}`);
    }
  } else {
    console.log("TELEGRAM_WEBHOOK_URL is not set. Server is running, but Telegram webhook was not registered.");
  }

  if (!secretToken) {
    console.log("TELEGRAM_WEBHOOK_SECRET_TOKEN is not set. Set it to verify Telegram webhook requests.");
  }

  const shutdown = (): void => {
    server.close(() => {
      console.log("Telegram webhook bot stopped.");
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

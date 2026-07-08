import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { AppConfig } from "../config.js";
import { prompt, promptPassword } from "../prompt.js";

const CONNECTION_RETRIES = 5;

export function createTelegramClient(config: AppConfig): TelegramClient {
  const stringSession = new StringSession(config.telegram.session);

  const client = new TelegramClient(
    stringSession,
    config.telegram.apiId,
    config.telegram.apiHash,
    {
      connectionRetries: CONNECTION_RETRIES,
    },
  );

  client.onError = async (error) => {
    if (error.message === "TIMEOUT") {
      return;
    }

    console.error("Telegram client error:", error);
  };

  return client;
}

export async function connectTelegramClient(config: AppConfig): Promise<TelegramClient> {
  const client = createTelegramClient(config);
  await client.connect();

  if (!(await client.isUserAuthorized())) {
    throw new Error("Telegram session is not authorized. Run: npm run dev -- login");
  }

  return client;
}

export async function loginTelegram(config: AppConfig): Promise<string> {
  const client = createTelegramClient(config);

  await client.start({
    phoneNumber: async () => prompt("Telegram phone number: "),
    phoneCode: async () => prompt("Telegram login code: "),
    password: async () => promptPassword("Telegram 2FA password, if requested: "),
    onError: (error) => {
      console.error("Telegram login error:", error.message);
    },
  });

  const session = client.session.save() as unknown as string;
  await client.disconnect();

  return session;
}

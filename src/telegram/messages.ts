import type { TelegramClient } from "telegram";
import { Api } from "telegram";
import type { ResolvedDialogEntity } from "./dialogs.ts";

export type MessageInfo = {
  id: number;
  publishedAt: string;
  senderId: string | null;
  text: string;
};

export async function listLastMessages(
  client: TelegramClient,
  entity: ResolvedDialogEntity,
  limit: number,
): Promise<MessageInfo[]> {
  const messages = await client.getMessages(entity, { limit });

  return messages
    .filter((message): message is Api.Message => message instanceof Api.Message)
    .map((message) => ({
      id: message.id,
      publishedAt: new Date(message.date * 1000).toISOString(),
      senderId: message.senderId?.toString() ?? null,
      text: message.message ?? "",
    }));
}

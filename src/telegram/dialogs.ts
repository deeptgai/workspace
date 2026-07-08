import type { TelegramClient } from "telegram";
import { Api } from "telegram";

export type ResolvedDialogEntity = Parameters<TelegramClient["getMessages"]>[0];

export type DialogInfo = {
  id: string;
  title: string;
  username: string | null;
  type: "channel" | "group" | "user" | "unknown";
};

export function getEntityType(entity: unknown): DialogInfo["type"] {
  if (entity instanceof Api.Channel) {
    return entity.megagroup ? "group" : "channel";
  }

  if (entity instanceof Api.Chat) {
    return "group";
  }

  if (entity instanceof Api.User) {
    return "user";
  }

  return "unknown";
}

export function getEntityUsername(entity: unknown): string | null {
  if (
    entity instanceof Api.Channel ||
    entity instanceof Api.User
  ) {
    return entity.username ?? null;
  }

  return null;
}

export function getEntityTitle(entity: unknown): string {
  if (entity instanceof Api.Channel || entity instanceof Api.Chat) {
    return entity.title;
  }

  if (entity instanceof Api.User) {
    const name = [entity.firstName, entity.lastName].filter(Boolean).join(" ");
    return name || entity.username || String(entity.id);
  }

  return "Unknown";
}

export function getEntityId(entity: unknown): string {
  if (
    entity instanceof Api.Channel ||
    entity instanceof Api.Chat ||
    entity instanceof Api.User
  ) {
    return entity.id.toString();
  }

  return "";
}

export function getDialogInfo(entity: unknown): DialogInfo {
  return {
    id: getEntityId(entity),
    title: getEntityTitle(entity),
    username: getEntityUsername(entity),
    type: getEntityType(entity),
  };
}

export async function listDialogs(client: TelegramClient, limit: number): Promise<DialogInfo[]> {
  const dialogs = await client.getDialogs({ limit });

  return dialogs
    .map((dialog) => dialog.entity)
    .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity))
    .map((entity) => ({
      ...getDialogInfo(entity),
    }))
    .filter((dialog) => dialog.type === "group" || dialog.type === "channel");
}

export async function resolveDialogEntity(
  client: TelegramClient,
  chat: string,
): Promise<ResolvedDialogEntity> {
  try {
    return await client.getEntity(chat) as ResolvedDialogEntity;
  } catch {
    const normalizedChat = chat.trim().replace(/^@/, "").toLowerCase();
    const dialogs = await client.getDialogs({ limit: 500 });
    const match = dialogs.find((dialog) => {
      const entity = dialog.entity;

      if (!entity) {
        return false;
      }

      const id = getEntityId(entity);
      const username = getEntityUsername(entity)?.toLowerCase();
      const title = getEntityTitle(entity).toLowerCase();

      return id === chat || username === normalizedChat || title === normalizedChat;
    });

    if (!match?.entity) {
      throw new Error(`Could not find chat or channel: ${chat}`);
    }

    return match.entity as ResolvedDialogEntity;
  }
}

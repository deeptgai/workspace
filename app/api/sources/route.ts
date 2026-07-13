import { NextResponse } from "next/server";
import { loadConfig } from "../../../src/config";
import { prisma } from "../../../src/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = loadConfig();
  const [{ TelegramClient }, { StringSession }, { listDialogs }] = await Promise.all([
    import("telegram"),
    import("telegram/sessions/index.js"),
    import("../../../src/telegram/dialogs"),
  ]);
  const client = new TelegramClient(
    new StringSession(config.telegram.session),
    config.telegram.apiId,
    config.telegram.apiHash,
    {
      connectionRetries: 5,
    },
  );

  try {
    await client.connect();

    if (!(await client.isUserAuthorized())) {
      return NextResponse.json(
        { error: "Telegram session is not authorized. Run: npm run dev -- login" },
        { status: 401 },
      );
    }

    const [sources, trackedChats] = await Promise.all([
      listDialogs(client, Number(process.env.UI_TELEGRAM_DIALOG_LIMIT || "500")),
      prisma.source.findMany({
        where: {
          provider: "telegram",
        },
        select: {
          externalId: true,
          username: true,
        },
      }),
    ]);
    const trackedIds = new Set(trackedChats.map((chat) => chat.externalId));
    const trackedUsernames = new Set(
      trackedChats
        .map((chat) => chat.username?.toLowerCase())
        .filter((username): username is string => Boolean(username)),
    );
    const availableSources = sources.filter((source) => {
      const username = source.username?.toLowerCase();

      return !trackedIds.has(source.id) && (!username || !trackedUsernames.has(username));
    });

    return NextResponse.json({ sources: availableSources });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load Telegram sources." },
      { status: 500 },
    );
  } finally {
    await client.destroy();
  }
}

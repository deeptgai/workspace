# DeepTG

Community Intelligence MVP scaffold for Telegram analysis.

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Fill these values in `.env`:

```text
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
```

You can get them from:

```text
https://my.telegram.org/apps
```

## Telegram Login

Authorize your own Telegram account:

```bash
npm run dev -- login
```

The command prints a `TELEGRAM_SESSION` value. Put it into `.env`:

```text
TELEGRAM_SESSION=...
```

## Telegram Bot Webhook

Create a bot in BotFather and add the token to `.env`:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=deep_signals_bot
TELEGRAM_SESSION_SECRET=
TELEGRAM_WEBHOOK_PORT=8787
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
TELEGRAM_WEBHOOK_SECRET_TOKEN=
TELEGRAM_MINI_APP_URL=
```

For local development, use a Cloudflare named tunnel with two hostnames:

```text
local.tgdeep.xyz -> http://localhost:3000
bot-local.tgdeep.xyz -> http://localhost:8787
```

Then start the bot:

```bash
npm run tgbot
```

The bot registers `TELEGRAM_WEBHOOK_URL` with Telegram on startup and listens on:

```text
POST /telegram/webhook
GET /health
```

Use these values for the local named tunnel:

```text
TELEGRAM_WEBHOOK_URL=https://bot-local.tgdeep.xyz
TELEGRAM_MINI_APP_URL=https://local.tgdeep.xyz/s
TELEGRAM_PEOPLE_SECTION_PRICE_STARS=1
TELEGRAM_TOOLS_SECTION_PRICE_STARS=1
```

Use this URL as the Mini App URL in BotFather:

```text
https://local.tgdeep.xyz/s
```

With the `signals_web` short name, publish channel links like this:

```text
https://t.me/deep_signals_bot/signals_web?startapp=anatoly-tolkit
```

The `Люди` and `Инструменты` sections are paid via Telegram Stars. The Mini App creates a Stars invoice from the Next API, opens it with `WebApp.openInvoice`, and the bot webhook marks access as paid after `successful_payment`.

For browser login with Telegram, configure Telegram OIDC credentials for the public domain:

```text
TELEGRAM_LOGIN_CLIENT_ID=
TELEGRAM_LOGIN_CLIENT_SECRET=
```

Then browser users can open `/auth/telegram?returnTo=/s/anatoly-tolkit`, complete the Telegram OIDC redirect, and receive the same signed session cookie used by the Mini App.

For local development, open the login page through a public configured domain instead of `localhost`:

```text
https://local.tgdeep.xyz/auth/telegram?returnTo=/s/anatoly-tolkit
```

Local dev shortcuts:

```bash
make web
make bot
make tunnel
make health
```

## CLI Commands

List chats and channels:

```bash
npm run dev -- chats
```

List more dialogs:

```bash
npm run dev -- chats --limit 100
```

Print the latest 10 messages from a chat or channel:

```bash
npm run dev -- messages @channel_username
```

You can also pass a chat id or exact title:

```bash
npm run dev -- messages "Some Group Title"
```

Change message limit:

```bash
npm run dev -- messages @channel_username --limit 20
```

## Import Messages

Start the local queue services:

```bash
docker compose up -d postgres redis
```

Start workers in a separate terminal:

```bash
npm run dev:worker
```

Enqueue message import into Postgres:

```bash
npm run dev -- import @channel_username
```

Import runs through BullMQ and uses checkpoints, so it can be restarted safely after interruption.

After a successful import, the worker automatically enqueues an embedding job.

Modes:

```bash
npm run dev -- import @channel_username --mode sync
npm run dev -- import @channel_username --mode new
npm run dev -- import @channel_username --mode backfill
```

Mode behavior:

- `sync` imports new messages first, then continues historical backfill.
- `new` imports messages newer than the saved `newestExternalId`.
- `backfill` imports older history before the saved `oldestExternalId`.

Batch options:

```bash
npm run dev -- import @channel_username --limit 500 --batch-size 100 --sleep-ms 3000
```

## Engagement And Stats

Imported chats are stored with a `type` field:

```text
channel
group
```

Message engagement is stored in dedicated columns:

```text
views
forwards
reactionsTotal
reactionCounts
repliesCount
hasComments
commentsPeerId
engagementScore
```

If messages were imported before these columns existed, backfill them from `rawJson`:

```bash
npm run dev -- engagement:backfill
```

Show stored statistics:

```bash
npm run dev -- stats @channel_username
```

Show fewer or more top messages:

```bash
npm run dev -- stats @channel_username --top 20
```

## RAG Memory

The project uses Postgres with `pgvector` for local semantic memory.

Fill embeddings settings in `.env`:

```text
EMBEDDINGS_BASE_URL=
EMBEDDINGS_API_KEY=
EMBEDDINGS_MODEL=
EMBEDDINGS_BATCH_SIZE=50
```

`EMBEDDINGS_BASE_URL` must point to an OpenAI-compatible API base URL.

Manually enqueue embeddings for imported messages:

```bash
npm run dev -- embed @channel_username --limit 100
```

Search embedded messages semantically:

```bash
npm run dev -- search @channel_username "startup fundraising mistakes"
```

Search only high-engagement messages:

```bash
npm run dev -- search @channel_username "startup fundraising mistakes" --min-engagement 50
```

This is the core retrieval layer that Flue agents can use later as a typed tool.

## Queues

The app uses BullMQ with Redis for background work.

Queues:

```text
telegram-import
message-embedding
chat-report
```

Run workers:

```bash
npm run dev:worker
```

Show queue status:

```bash
npm run dev -- queue:status
```

## Markdown Reports

Generate a Markdown community report through the `chat-report` queue:

```bash
npm run dev -- report @channel_username
```

List stored reports:

```bash
npm run dev -- reports @channel_username
```

Print the latest report Markdown:

```bash
npm run dev -- reports @channel_username --markdown
```

## Web UI

Start the Next.js dashboard:

```bash
npm run dev:web
```

Open:

```text
http://localhost:3000
```

The UI shows:

- Imported chats and channels
- Message, embedding, and report counts
- Engagement stats
- Top messages by engagement
- Generated Markdown report artifacts

Compiled worker:

```bash
npm run build
npm run worker
```

## Build

```bash
npm run build
```

Run the compiled CLI:

```bash
npm run cli -- chats
```

SHELL := /bin/bash

TUNNEL_CONFIG ?= $(HOME)/.cloudflared/deeptg-local.yml
WEB_URL ?= https://local.tgdeep.xyz
BOT_URL ?= https://bot-local.tgdeep.xyz
WEB_PORT ?= 3000
BOT_PORT ?= 8787

.PHONY: help install web bot worker tunnel up health tunnel-check ports db-up db-migrate typecheck stars-check stars-live

help:
	@printf "Targets:\n"
	@printf "  make install       Install npm dependencies\n"
	@printf "  make web           Start Next.js on localhost:%s\n" "$(WEB_PORT)"
	@printf "  make bot           Start Telegram webhook bot on localhost:%s\n" "$(BOT_PORT)"
	@printf "  make tunnel        Start Cloudflare named tunnel\n"
	@printf "  make up            Print the three local dev commands to run\n"
	@printf "  make health        Check local and public app/bot endpoints\n"
	@printf "  make tunnel-check  Validate Cloudflare tunnel ingress config\n"
	@printf "  make ports         Show listeners on %s and %s\n" "$(WEB_PORT)" "$(BOT_PORT)"
	@printf "  make db-up         Start local Postgres and Redis\n"
	@printf "  make db-migrate    Apply Prisma migrations\n"
	@printf "  make typecheck     Run TypeScript check\n"
	@printf "  make stars-check   Print and validate Stars invoice request JSON\n"
	@printf "  make stars-live    Create a live Telegram Stars invoice link\n"

install:
	npm install

web:
	npm run dev:web

bot:
	npm run tgbot

worker:
	npm run dev:worker

tunnel:
	cloudflared --config "$(TUNNEL_CONFIG)" tunnel run deeptg-local

up:
	@printf "Run these in separate terminals:\n"
	@printf "  make web\n"
	@printf "  make bot\n"
	@printf "  make tunnel\n"

health:
	@printf "Local web: "
	@curl -fsS -o /dev/null -w "%{http_code}\n" "http://localhost:$(WEB_PORT)/s/anatoly-tolkit" || true
	@printf "Local bot: "
	@curl -fsS -o /dev/null -w "%{http_code}\n" "http://localhost:$(BOT_PORT)/health" || true
	@printf "Public web: "
	@curl -fsS -o /dev/null -w "%{http_code}\n" "$(WEB_URL)/s/anatoly-tolkit" || true
	@printf "Public bot: "
	@curl -fsS -o /dev/null -w "%{http_code}\n" "$(BOT_URL)/health" || true

tunnel-check:
	cloudflared --config "$(TUNNEL_CONFIG)" tunnel ingress validate
	cloudflared tunnel info deeptg-local

ports:
	@lsof -nP -iTCP:$(WEB_PORT) -sTCP:LISTEN || true
	@lsof -nP -iTCP:$(BOT_PORT) -sTCP:LISTEN || true

db-up:
	docker compose up -d postgres redis

db-migrate:
	npm run db:deploy

typecheck:
	npm run typecheck

stars-check:
	npm run stars:check

stars-live:
	LIVE=1 npm run stars:check

"use client";

import type { ChannelSnapshotDocument } from "../../../src/snapshots/sourceSnapshotSchema";
import { TelegramAuthBadge, type TelegramAuthUser, type TelegramWebApp } from "./TelegramAuthBadge";
import { cleanSnapshotText } from "./snapshotSignalPresentation";

type SnapshotHeroProps = {
  actorname?: string | null;
  getTelegramWebApp: () => Promise<TelegramWebApp | null>;
  initialTelegramUser?: TelegramAuthUser | null;
  loginUrl: string;
  snapshot: ChannelSnapshotDocument;
};

const heroSectionClass = "relative min-h-[170px] overflow-hidden rounded-lg border border-slate-200 bg-cover bg-center shadow-sm motion-safe:animate-[snapshotFadeIn_360ms_ease-out] md:min-h-[188px]";
const heroContentClass = "relative flex min-h-[170px] flex-col justify-end p-4 md:min-h-[188px] md:p-5";
const heroTitleClass = "max-w-3xl text-3xl font-black leading-none text-white md:text-5xl";
const heroLinkClass = "mb-3 inline-flex w-fit min-h-8 items-center rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-black text-white backdrop-blur transition duration-200 hover:bg-white/20 hover:text-white";
const heroSummaryMaxLength = 240;

const heroPalettes = {
  emerald: ["#10221b", "#5d7e65", "#dce1d2", "#eee8da"],
  indigo: ["#151b3d", "#5161a8", "#d9def2", "#eef0f7"],
  amber: ["#251c12", "#ad7c31", "#ead7a8", "#f6efe1"],
  rose: ["#2a141a", "#a45467", "#ead5d8", "#f7eeee"],
  slate: ["#111827", "#64748b", "#d9e1e7", "#f1f5f9"],
  cyan: ["#09242a", "#2b8aa0", "#c9e9ee", "#edf7f8"],
} as const;

const heroMotifs = new Set(["network", "notes", "city", "market", "studio", "landscape"]);

function stableIndex(value: string, modulo: number) {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash % modulo;
}

function heroSummary(snapshot: ChannelSnapshotDocument) {
  const cleaned = cleanSnapshotText(snapshot.summary ?? undefined);

  if (!cleaned) {
    return "Карта сигналов канала: идеи, боли, гипотезы, материалы, инструменты, места и люди.";
  }

  const sentences = cleaned
    .match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [cleaned];
  const teaser = sentences.slice(0, 2).join(" ").replace(/\s+/g, " ").trim();

  return teaser.length <= heroSummaryMaxLength
    ? teaser
    : `${teaser.slice(0, heroSummaryMaxLength - 3).trimEnd()}...`;
}

function heroBackground(snapshot: ChannelSnapshotDocument) {
  if (snapshot.coverImage?.url) {
    return `linear-gradient(105deg, rgba(16,24,32,.92), rgba(16,24,32,.58) 58%, rgba(16,24,32,.16)), url("${snapshot.coverImage.url}")`;
  }

  const paletteKeys = Object.keys(heroPalettes) as Array<keyof typeof heroPalettes>;
  const fallbackPalette = paletteKeys[stableIndex(`${snapshot.sourceId}:${snapshot.chatTitle}`, paletteKeys.length)];
  const paletteName = snapshot.heroTheme?.palette && snapshot.heroTheme.palette in heroPalettes
    ? snapshot.heroTheme.palette
    : fallbackPalette;
  const motif = snapshot.heroTheme?.motif && heroMotifs.has(snapshot.heroTheme.motif)
    ? snapshot.heroTheme.motif
    : "network";
  const [ink, mid, wash, paper] = heroPalettes[paletteName];
  const motifs: Record<string, string> = {
    network: `
      <rect width="1400" height="620" fill="${wash}"/>
      <g fill="none" stroke="${mid}" stroke-width="3" opacity=".52">
        <path d="M120 430 C270 260 430 360 580 190 S930 250 1120 120"/>
        <path d="M210 520 C390 420 520 480 700 345 S1050 390 1255 250"/>
        <path d="M170 210 C360 140 470 185 630 110 S920 150 1110 80"/>
      </g>
      <g fill="${ink}" opacity=".82">
        <circle cx="170" cy="210" r="20"/><circle cx="580" cy="190" r="26"/><circle cx="1120" cy="120" r="24"/>
        <circle cx="210" cy="520" r="18"/><circle cx="700" cy="345" r="22"/><circle cx="1255" cy="250" r="20"/>
      </g>`,
    notes: `
      <rect width="1400" height="620" fill="${paper}"/>
      <g transform="rotate(-7 700 310)" fill="${wash}" stroke="${mid}" stroke-width="3">
        <rect x="170" y="130" width="360" height="250" rx="22"/>
        <rect x="560" y="80" width="400" height="315" rx="22"/>
        <rect x="930" y="185" width="310" height="230" rx="22"/>
      </g>
      <g stroke="${ink}" stroke-width="11" stroke-linecap="round" opacity=".62">
        <path d="M235 220h220M235 275h170M635 180h250M635 242h205M635 305h160M995 285h170M995 340h125"/>
      </g>`,
    city: `
      <rect width="1400" height="620" fill="${wash}"/>
      <path d="M0 430 C220 330 430 360 640 255 C850 150 1055 210 1400 115 L1400 620 L0 620 Z" fill="${paper}"/>
      <g fill="${mid}" opacity=".75">
        <rect x="760" y="185" width="95" height="290"/><rect x="880" y="130" width="120" height="345"/>
        <rect x="1030" y="225" width="90" height="250"/><rect x="1150" y="165" width="135" height="310"/>
      </g>
      <path d="M0 520 C300 455 590 500 850 420 C1080 350 1230 365 1400 305 L1400 620 L0 620 Z" fill="${ink}" opacity=".78"/>`,
    market: `
      <rect width="1400" height="620" fill="${paper}"/>
      <g fill="none" stroke="${mid}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" opacity=".75">
        <path d="M170 430 L340 315 L515 360 L700 210 L895 260 L1080 145 L1250 190"/>
        <path d="M170 500 L340 410 L515 435 L700 335 L895 375 L1080 285 L1250 315"/>
      </g>
      <g fill="${ink}" opacity=".86">
        <circle cx="700" cy="210" r="24"/><circle cx="1080" cy="145" r="28"/><circle cx="1250" cy="190" r="20"/>
      </g>`,
    studio: `
      <rect width="1400" height="620" fill="${wash}"/>
      <circle cx="1030" cy="230" r="210" fill="${mid}" opacity=".55"/>
      <circle cx="1120" cy="180" r="84" fill="${paper}" opacity=".86"/>
      <path d="M120 500 C285 350 455 390 590 265 C735 130 930 245 1080 330 C1200 398 1310 405 1400 385 L1400 620 L0 620 Z" fill="${ink}" opacity=".78"/>
      <path d="M160 215 h480" stroke="${ink}" stroke-width="18" stroke-linecap="round" opacity=".35"/>`,
    landscape: `
      <rect width="1400" height="620" fill="${wash}"/>
      <path d="M0 465 C200 382 330 420 515 332 C735 226 880 280 1070 202 C1230 136 1340 145 1400 110 L1400 620 L0 620 Z" fill="${mid}"/>
      <path d="M0 555 C230 470 440 500 690 420 C950 338 1115 360 1400 275 L1400 620 L0 620 Z" fill="${ink}" opacity=".72"/>
      <path d="M0 585 C260 540 490 555 760 512 C1010 472 1195 482 1400 435 L1400 620 L0 620 Z" fill="${paper}"/>`,
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 620">${motifs[motif]}</svg>`;

  return `linear-gradient(105deg, rgba(16,24,32,.92), rgba(16,24,32,.56) 60%, rgba(16,24,32,.12)), url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function SnapshotHero({ actorname, getTelegramWebApp, initialTelegramUser, loginUrl, snapshot }: SnapshotHeroProps) {
  return (
    <section
      className={heroSectionClass}
      style={{
        backgroundImage: heroBackground(snapshot),
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
      <div className="absolute right-3 top-3 z-10 sm:right-4 sm:top-4">
        <TelegramAuthBadge
          getTelegramWebApp={getTelegramWebApp}
          initialTelegramUser={initialTelegramUser}
          loginUrl={loginUrl}
          variant="hero"
        />
      </div>
      <div className={heroContentClass}>
        {actorname ? (
          <a
            className={heroLinkClass}
            href={`https://t.me/${actorname}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#fff" }}
          >
            @{actorname}
          </a>
        ) : null}
        <h1 className={heroTitleClass}>{snapshot.chatTitle}</h1>
        <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-white/85 md:text-base">
          {heroSummary(snapshot)}
        </p>
      </div>
    </section>
  );
}

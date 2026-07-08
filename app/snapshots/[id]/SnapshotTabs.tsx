"use client";

import { useMemo, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  Lightbulb,
  MapPin,
  MessageCircleQuestion,
  Network,
  Sparkles,
  Target,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  ChannelSnapshotDocument,
  SnapshotEvidenceRef,
  SnapshotSignal,
  SnapshotSignalKind,
} from "../../../src/snapshots/sourceSnapshotSchema";

type EvidenceMessage = {
  externalId: string;
  publishedAt: string;
  text: string | null;
  views: number | null;
  forwards: number | null;
  reactionsTotal: number;
  repliesCount: number;
  engagementScore: number;
  user: {
    externalId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

type SnapshotTabsProps = {
  snapshot: ChannelSnapshotDocument;
  evidenceMessages: EvidenceMessage[];
  people: SnapshotPerson[];
  actorname?: string | null;
};

type SnapshotPerson = {
  user: {
    externalId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    photo: string | null;
  } | null;
  comments: number;
  reactions: number;
  replies: number;
  avgEngagement: number;
  lastCommentAt: string | null;
  examples: Array<{
    externalId: string;
    text: string | null;
    publishedAt: string;
    parent: {
      externalId: string;
      text: string | null;
      publishedAt: string;
    } | null;
  }>;
};

const signalTabs: Array<{ id: SnapshotSignalKind | "all"; label: string }> = [
  { id: "all", label: "Все" },
  { id: "idea", label: "Идеи" },
  { id: "pain", label: "Боли" },
  { id: "hypothesis", label: "Гипотезы" },
  { id: "insight", label: "Инсайты" },
  { id: "material", label: "Материалы" },
  { id: "tool", label: "Инструменты" },
  { id: "place", label: "Места" },
  { id: "person", label: "Люди" },
];

const signalTabIcons: Record<SnapshotSignalKind | "all", LucideIcon> = {
  all: Network,
  idea: Lightbulb,
  pain: Target,
  hypothesis: MessageCircleQuestion,
  insight: Sparkles,
  material: BookOpen,
  tool: Wrench,
  place: MapPin,
  person: Users,
};

const kindLabels: Record<SnapshotSignalKind, string> = {
  idea: "идея",
  pain: "боль",
  hypothesis: "гипотеза",
  insight: "инсайт",
  material: "материал",
  tool: "инструмент",
  place: "место",
  person: "человек",
};

const structuralTags = new Set([
  "идея",
  "идеи",
  "боль",
  "боли",
  "гипотеза",
  "гипотезы",
  "инсайт",
  "инсайты",
  "материал",
  "материалы",
  "инструмент",
  "инструменты",
  "место",
  "места",
  "человек",
  "люди",
  "idea",
  "pain",
  "hypothesis",
  "insight",
  "material",
  "tool",
  "place",
  "person",
  "профиль",
  "profile",
  "peer",
]);

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("ru-RU").format(value ?? 0);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function cleanSnapshotText(value: string | undefined) {
  if (!value) {
    return "";
  }

  return value
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)?t\.me\/[^)]+\)/gi, "$1")
    .replace(/\s*\((?:посты|постов|пост|posts?)\s+id\s*=\s*[\d,\s]+\)/gi, "")
    .replace(/\s*\((?:itemId|message\s+id|msg\s+id)\s*[:#=]?\s*[\d,\s]+\)/gi, "")
    .replace(/\s*-100\d{6,}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function uniqueEvidence(evidence: SnapshotEvidenceRef[] | undefined) {
  const seen = new Set<string>();
  return (evidence ?? []).filter((item) => {
    if (seen.has(item.itemId)) return false;
    seen.add(item.itemId);
    return true;
  });
}

function personDisplayName(person: SnapshotPerson | null | undefined) {
  if (!person?.user) return "Пользователь";
  return [person.user.firstName, person.user.lastName].filter(Boolean).join(" ") ||
    (person.user.username ? `@${person.user.username}` : "Пользователь");
}

function personInitials(signal: SnapshotSignal, person: SnapshotPerson | null | undefined) {
  const name = signal.person?.name || personDisplayName(person) || signal.title;
  return name.replace(/^@/, "").slice(0, 2).toUpperCase();
}

function findSignalPerson(signal: SnapshotSignal, people: SnapshotPerson[]) {
  if (signal.kind !== "person") return null;

  return people.find((person) => {
    if (!person.user) return false;
    if (signal.person?.actorExternalId && person.user.externalId === signal.person.actorExternalId) return true;
    if (signal.person?.username && person.user.username?.toLowerCase() === signal.person.username.toLowerCase().replace(/^@/, "")) return true;
    return false;
  }) ?? null;
}

function signalKindClass(kind: SnapshotSignalKind) {
  const styles: Record<SnapshotSignalKind, string> = {
    idea: "bg-emerald-50 text-emerald-800",
    pain: "bg-rose-50 text-rose-800",
    hypothesis: "bg-violet-50 text-violet-800",
    insight: "bg-blue-50 text-blue-800",
    material: "bg-blue-50 text-blue-800",
    tool: "bg-amber-50 text-amber-800",
    place: "bg-rose-50 text-rose-800",
    person: "bg-emerald-50 text-emerald-800",
  };

  return `w-fit rounded-full px-2 py-1 text-xs font-black ${styles[kind]}`;
}

function visibleSignalTags(signal: SnapshotSignal) {
  return (signal.tags ?? []).filter((tag) => {
    const trimmed = tag.trim();

    return Boolean(trimmed) &&
      !structuralTags.has(trimmed.toLowerCase()) &&
      trimmed.length <= 24 &&
      trimmed.split(/\s+/).length <= 3;
  });
}

function avatarClass(signal: SnapshotSignal) {
  if (signal.kind !== "person") return "";

  return "grid h-11 w-11 flex-none place-items-center rounded-full bg-gradient-to-br from-emerald-700 to-lime-300 text-sm font-black text-white shadow-inner ring-2 ring-white/40";
}

function heroSummary(snapshot: ChannelSnapshotDocument, signals: SnapshotSignal[]) {
  const candidate = signals.find((signal) => signal.kind === "idea" || signal.kind === "insight") ?? signals[0];
  return cleanSnapshotText(candidate?.summary) || "Карта сигналов канала: идеи, боли, гипотезы, материалы, инструменты, места и люди.";
}

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

function heroBackground(snapshot: ChannelSnapshotDocument) {
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

export function SnapshotTabs({ snapshot, evidenceMessages, people, actorname }: SnapshotTabsProps) {
  const [activeTab, setActiveTab] = useState<SnapshotSignalKind | "all">("all");
  const [selectedTag, setSelectedTag] = useState("");
  const [activeSignalId, setActiveSignalId] = useState<string | null>(null);
  const [activeEvidenceItemId, setActiveEvidenceItemId] = useState<string | null>(null);
  const evidenceById = useMemo(
    () => new Map(evidenceMessages.map((message) => [message.externalId, message])),
    [evidenceMessages],
  );
  const signals = snapshot.signals;
  const activeSignal = activeSignalId ? signals.find((signal) => signal.id === activeSignalId) ?? null : null;
  const activeSignalEvidence = useMemo(() => uniqueEvidence(activeSignal?.evidence), [activeSignal]);
  const activeEvidence = activeSignalEvidence.find((evidence) => evidence.itemId === activeEvidenceItemId) ?? activeSignalEvidence[0] ?? null;
  const activeMessage = activeEvidence ? evidenceById.get(activeEvidence.itemId) : null;
  const sourceItemUrl = activeMessage && actorname
    ? `https://t.me/${actorname}/${activeMessage.externalId}`
    : null;
  const tabSignals = useMemo(
    () => signals.filter((signal) => activeTab === "all" || signal.kind === activeTab),
    [activeTab, signals],
  );
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const signal of tabSignals) {
      for (const tag of visibleSignalTags(signal)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
      .slice(0, 12)
      .map(([tag]) => tag);
  }, [tabSignals]);
  const filteredSignals = tabSignals.filter((signal) => {
    const byTag = !selectedTag || visibleSignalTags(signal).includes(selectedTag);
    return byTag;
  });
  const selectTab = (tab: SnapshotSignalKind | "all") => {
    setActiveTab(tab);
    setSelectedTag("");
  };
  const openSignal = (signal: SnapshotSignal, evidence?: SnapshotEvidenceRef) => {
    setActiveSignalId(signal.id);
    setActiveEvidenceItemId(evidence?.itemId ?? uniqueEvidence(signal.evidence)[0]?.itemId ?? null);
  };
  const closeSignal = () => {
    setActiveSignalId(null);
    setActiveEvidenceItemId(null);
  };

  return (
    <>
      <section className="grid items-start gap-4 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="sticky top-4 z-20 rounded-lg border border-slate-200 bg-white/90 p-3 shadow-sm backdrop-blur-xl">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
	            <b className="block text-sm font-black text-slate-950">Карта сигналов</b>
	            <span className="mt-1 block text-xs font-bold text-slate-500">
	              {formatNumber(signals.length)} сигналов
	            </span>
          </div>
          <nav className="mt-3 grid grid-cols-2 gap-1.5 lg:grid-cols-1" aria-label="Разделы сигналов">
            {signalTabs.map((tab) => {
              const count = tab.id === "all" ? signals.length : signals.filter((signal) => signal.kind === tab.id).length;
              const Icon = signalTabIcons[tab.id];
              return (
                <button
                  className={`group flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm font-black transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 ${
                    activeTab === tab.id ? "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-sm" : "border-transparent text-slate-600"
                  }`}
                  key={tab.id}
                  type="button"
                  onClick={() => selectTab(tab.id)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 flex-none" strokeWidth={2.4} />
                    <span className="truncate">{tab.label}</span>
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-black text-slate-500 shadow-sm">{count}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0">
          <section
            className="relative min-h-[170px] overflow-hidden rounded-lg border border-slate-200 bg-cover bg-center shadow-sm motion-safe:animate-[snapshotFadeIn_360ms_ease-out] md:min-h-[188px]"
            style={{
              backgroundImage: heroBackground(snapshot),
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
            <div className="relative flex min-h-[170px] flex-col justify-end p-4 md:min-h-[188px] md:p-5">
              {actorname ? (
                <a
                  className="mb-3 inline-flex w-fit min-h-8 items-center rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-black text-white backdrop-blur transition duration-200 hover:bg-white/20 hover:text-white"
	                  href={`https://t.me/${actorname}`}
	                  target="_blank"
	                  rel="noreferrer"
	                  style={{ color: "#fff" }}
	                >
                  @{actorname}
                </a>
              ) : null}
              <h1 className="max-w-3xl text-3xl font-black leading-none text-white md:text-5xl">{snapshot.chatTitle}</h1>
              <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-white/85 md:text-base">
                {heroSummary(snapshot, signals)}
              </p>
            </div>
          </section>

          {tags.length ? (
            <section className="my-3 motion-safe:animate-[snapshotFadeIn_360ms_ease-out]" aria-label="Фильтры по тегам">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <button
                    className={`min-h-10 flex-none cursor-pointer rounded-full border px-3 py-2 text-sm font-black transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 ${
                      selectedTag === tag ? "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-sm" : "border-slate-200 bg-white text-slate-600"
                    }`}
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTag(selectedTag === tag ? "" : tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="motion-safe:animate-[snapshotFadeIn_420ms_ease-out]">
            {filteredSignals.length ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
	                {filteredSignals.map((signal, index) => {
	                  const person = findSignalPerson(signal, people);

                  return (
	                    <article
	                      className="group flex min-h-[190px] cursor-pointer flex-col justify-between rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-lg motion-safe:animate-[snapshotFadeIn_320ms_ease-out]"
	                      key={signal.id}
	                      role="button"
	                      tabIndex={0}
	                      onClick={() => openSignal(signal)}
	                      onKeyDown={(event) => {
	                        if (event.key === "Enter" || event.key === " ") {
	                          event.preventDefault();
	                          openSignal(signal);
	                        }
	                      }}
	                      style={{ animationDelay: `${Math.min(index * 28, 240)}ms` }}
	                    >
	                      <div>
	                        <div className="flex items-start">
	                          <span className={signalKindClass(signal.kind)}>{kindLabels[signal.kind]}</span>
	                        </div>

                        {signal.kind === "person" ? (
                          <div className="mt-3 flex items-center gap-2">
                            {person?.user?.photo ? (
                              <img alt="" className="h-11 w-11 flex-none rounded-full object-cover ring-2 ring-white/60" src={person.user.photo} />
                            ) : (
                              <span className={avatarClass(signal)}>{personInitials(signal, person)}</span>
                            )}
                            <h3 className="m-0 text-lg font-black leading-tight text-slate-950">
	                              {signal.url ? (
	                                <a className="text-emerald-800 underline decoration-emerald-800/30 underline-offset-4 transition hover:text-emerald-950" href={signal.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
	                                  {cleanSnapshotText(signal.title)}
	                                </a>
                              ) : cleanSnapshotText(signal.title)}
                            </h3>
                          </div>
                        ) : (
                          <h3 className="m-0 mt-3 text-lg font-black leading-tight text-slate-950">
	                            {signal.url ? (
	                              <a className="text-emerald-800 underline decoration-emerald-800/30 underline-offset-4 transition hover:text-emerald-950" href={signal.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
	                                {cleanSnapshotText(signal.title)}
	                              </a>
                            ) : cleanSnapshotText(signal.title)}
                          </h3>
                        )}

                        <p className="m-0 mt-2 text-sm leading-6 text-slate-600">{cleanSnapshotText(signal.summary)}</p>
                      </div>

	                      <div className="mt-2 flex flex-wrap gap-1">
	                        {visibleSignalTags(signal).map((tag) => (
	                          <button
                          className="cursor-pointer rounded-full border border-slate-200 bg-[#f4f0e7] px-2 py-1 text-xs font-black text-slate-500 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
	                            key={tag}
	                            type="button"
	                            onClick={(event) => {
	                              event.stopPropagation();
	                              setSelectedTag(tag);
	                            }}
	                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 bg-white/70 p-8 text-center text-sm font-black text-slate-500">
                Ничего не найдено. Попробуй другой раздел или сбрось тег.
              </div>
            )}
          </section>
        </div>
      </section>

	      {activeSignal ? (
	        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-3 backdrop-blur-sm" role="presentation" onClick={closeSignal}>
	          <aside
	            className="grid max-h-[92vh] w-full max-w-5xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl motion-safe:animate-[snapshotFadeIn_220ms_ease-out]"
	            role="dialog"
	            aria-modal="true"
	            onClick={(event) => event.stopPropagation()}
	          >
	            <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-[#f9f6ed] p-4">
	              <div className="min-w-0">
	                <span className={signalKindClass(activeSignal.kind)}>{kindLabels[activeSignal.kind]}</span>
	                <h2 className="m-0 mt-2 text-2xl font-black leading-tight text-slate-950">{cleanSnapshotText(activeSignal.title)}</h2>
	                <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-slate-600">{cleanSnapshotText(activeSignal.summary)}</p>
	                {visibleSignalTags(activeSignal).length ? (
	                  <div className="mt-3 flex flex-wrap gap-1.5">
	                    {visibleSignalTags(activeSignal).map((tag) => (
	                      <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-black text-slate-600" key={tag}>{tag}</span>
	                    ))}
	                  </div>
	                ) : null}
	              </div>
	              <button
	                className="grid h-10 w-10 flex-none cursor-pointer place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-rose-50 hover:text-rose-700"
	                type="button"
	                aria-label="Закрыть"
	                onClick={closeSignal}
	              >
	                <X size={20} />
	              </button>
	            </header>
	
	            <div className="min-h-0 overflow-auto p-4">
	              {activeSignalEvidence.length ? (
	                <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Посты сигнала">
	                  {activeSignalEvidence.map((evidence, index) => {
	                    const isActive = activeEvidence?.itemId === evidence.itemId;
	                    return (
	                      <button
	                        className={`min-h-10 flex-none cursor-pointer rounded-lg border px-3 py-2 text-sm font-black transition hover:-translate-y-0.5 ${
	                          isActive ? "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
	                        }`}
	                        key={evidence.itemId}
	                        type="button"
	                        role="tab"
	                        aria-selected={isActive}
	                        onClick={() => setActiveEvidenceItemId(evidence.itemId)}
	                      >
	                        Пост {index + 1}
	                      </button>
	                    );
	                  })}
	                </div>
	              ) : null}

	              {activeMessage ? (
	                <div className="mb-3 flex flex-wrap gap-1.5">
	                  <span className="rounded-full bg-slate-50 px-2 py-1 text-xs font-black text-slate-600">{formatDateTime(activeMessage.publishedAt)}</span>
	                  <span className="rounded-full bg-slate-50 px-2 py-1 text-xs font-black text-slate-600">{formatNumber(activeMessage.views)} просмотров</span>
	                  <span className="rounded-full bg-slate-50 px-2 py-1 text-xs font-black text-slate-600">{formatNumber(activeMessage.reactionsTotal)} реакций</span>
	                  <span className="rounded-full bg-slate-50 px-2 py-1 text-xs font-black text-slate-600">рейтинг {activeMessage.engagementScore.toFixed(2)}</span>
	                </div>
	              ) : null}

	              {activeEvidence?.reason ? (
	                <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
	                  <b className="block text-xs uppercase tracking-[0.12em] text-emerald-800">Почему это важно</b>
	                  {cleanSnapshotText(activeEvidence.reason)}
	                </div>
	              ) : null}
	
	              {activeMessage ? (
	                <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 text-[15px] leading-7 text-slate-700">
                  {activeMessage.text || "У сообщения нет текстового содержимого."}
                </div>
	              ) : (
	                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center text-slate-500">
	                  У этого сигнала нет загруженных постов-подтверждений.
	                </div>
	              )}

              <div className="mt-3 flex flex-wrap gap-2">
	                {sourceItemUrl ? (
	                  <a
	                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-black text-sky-700 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-100 hover:text-sky-900"
	                    href={sourceItemUrl}
	                    target="_blank"
	                    rel="noreferrer"
	                  >
	                    <ExternalLink size={15} />
	                    Открыть в Telegram
	                  </a>
	                ) : null}
	              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

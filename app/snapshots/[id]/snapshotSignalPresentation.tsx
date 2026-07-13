import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  Lightbulb,
  MapPin,
  MessageCircleQuestion,
  Network,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { SnapshotSignal, SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";

export type SnapshotPerson = {
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

export const signalTabs: Array<{ id: SnapshotSignalKind | "all"; label: string }> = [
  { id: "all", label: "Все" },
  { id: "idea", label: "Идеи" },
  { id: "pain", label: "Боли" },
  { id: "risk", label: "Риски" },
  { id: "hypothesis", label: "Гипотезы" },
  { id: "insight", label: "Инсайты" },
  { id: "trend", label: "Тренды" },
  { id: "event", label: "События" },
  { id: "material", label: "Материалы" },
  { id: "tool", label: "Инструменты" },
  { id: "place", label: "Места" },
  { id: "person", label: "Люди" },
];

export const signalTabIcons: Record<SnapshotSignalKind | "all", LucideIcon> = {
  all: Network,
  idea: Lightbulb,
  pain: Target,
  risk: AlertTriangle,
  hypothesis: MessageCircleQuestion,
  insight: Sparkles,
  trend: TrendingUp,
  event: CalendarDays,
  material: BookOpen,
  tool: Wrench,
  place: MapPin,
  person: Users,
};

export const kindLabels: Record<SnapshotSignalKind, string> = {
  idea: "идея",
  pain: "боль",
  risk: "риск",
  hypothesis: "гипотеза",
  insight: "инсайт",
  trend: "тренд",
  event: "событие",
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
  "риск",
  "риски",
  "гипотеза",
  "гипотезы",
  "инсайт",
  "инсайты",
  "тренд",
  "тренды",
  "событие",
  "события",
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
  "risk",
  "hypothesis",
  "insight",
  "trend",
  "event",
  "material",
  "tool",
  "place",
  "person",
  "профиль",
  "profile",
  "peer",
]);

export const dayMs = 24 * 60 * 60 * 1000;
const monthNames = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];
const monthNamesGenitive = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const shortMonthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];

function validDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function formatInteger(value: number | null | undefined) {
  return String(value ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatSignalPeriod(value: string) {
  const date = validDate(value);

  if (!date) {
    return "";
  }

  const month = monthNames[date.getUTCMonth()] ?? "";
  const year = String(date.getUTCFullYear());

  return [month.charAt(0).toUpperCase() + month.slice(1), year].filter(Boolean).join(" ");
}

export function formatTimelineDay(day: number) {
  const date = new Date(day * dayMs);
  const month = shortMonthNames[date.getUTCMonth()] ?? "";

  return `${padDatePart(date.getUTCDate())} ${month} ${date.getUTCFullYear()} г.`;
}

export function formatTimelineMonth(day: number) {
  const date = new Date(day * dayMs);

  return shortMonthNames[date.getUTCMonth()]?.replace(".", "") ?? "";
}

export function formatDateTime(value: string) {
  const date = validDate(value);

  if (!date) {
    return "";
  }

  const month = monthNamesGenitive[date.getUTCMonth()] ?? "";

  return [
    `${padDatePart(date.getUTCDate())} ${month} ${date.getUTCFullYear()} г.`,
    `${padDatePart(date.getUTCHours())}:${padDatePart(date.getUTCMinutes())}`,
  ].join(", ");
}

export function signalTimelineBadges(signal: SnapshotSignal) {
  const timeline = signal.timeline;

  if (!timeline) {
    return [];
  }

  const labels = [
    timeline.firstPostAt ? formatSignalPeriod(timeline.firstPostAt) : null,
    timeline.firstCommentAt ? formatSignalPeriod(timeline.firstCommentAt) : null,
    timeline.firstEvidenceAt ? formatSignalPeriod(timeline.firstEvidenceAt) : null,
  ].filter((item): item is string => Boolean(item));

  return [...new Set(labels)].slice(0, 2);
}

export function signalDate(signal: SnapshotSignal) {
  const value = signal.timeline?.lastEvidenceAt ??
    signal.timeline?.firstEvidenceAt ??
    signal.timeline?.firstPostAt ??
    signal.timeline?.firstCommentAt;

  if (!value) {
    return null;
  }

  return validDate(value);
}

export function signalYear(signal: SnapshotSignal) {
  const date = signalDate(signal);

  return date ? String(date.getUTCFullYear()) : null;
}

export function signalDayValue(signal: SnapshotSignal) {
  const date = signalDate(signal);

  return date ? Math.floor(date.getTime() / dayMs) : null;
}

export function shouldShowPreviewImage(signal: SnapshotSignal) {
  return signal.kind !== "person" && Boolean(signal.previewImage?.url);
}

export function cleanSnapshotText(value: string | undefined) {
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

function personDisplayName(person: SnapshotPerson | null | undefined) {
  if (!person?.user) return "Пользователь";
  return [person.user.firstName, person.user.lastName].filter(Boolean).join(" ") ||
    (person.user.username ? `@${person.user.username}` : "Пользователь");
}

export function personInitials(signal: SnapshotSignal, person: SnapshotPerson | null | undefined) {
  const name = signal.person?.name || personDisplayName(person) || signal.title;
  return name.replace(/^@/, "").slice(0, 2).toUpperCase();
}

export function findSignalPerson(signal: SnapshotSignal, people: SnapshotPerson[]) {
  if (signal.kind !== "person") return null;

  return people.find((person) => {
    if (!person.user) return false;
    if (signal.person?.actorExternalId && person.user.externalId === signal.person.actorExternalId) return true;
    if (signal.person?.username && person.user.username?.toLowerCase() === signal.person.username.toLowerCase().replace(/^@/, "")) return true;
    return false;
  }) ?? null;
}

export function signalKindClass(kind: SnapshotSignalKind) {
  const styles: Record<SnapshotSignalKind, string> = {
    idea: "bg-emerald-50 text-emerald-800",
    pain: "bg-rose-50 text-rose-800",
    risk: "bg-orange-50 text-orange-800",
    hypothesis: "bg-violet-50 text-violet-800",
    insight: "bg-blue-50 text-blue-800",
    trend: "bg-cyan-50 text-cyan-800",
    event: "bg-slate-100 text-slate-800",
    material: "bg-blue-50 text-blue-800",
    tool: "bg-amber-50 text-amber-800",
    place: "bg-rose-50 text-rose-800",
    person: "bg-emerald-50 text-emerald-800",
  };

  return `w-fit rounded-full px-2 py-1 text-xs font-black ${styles[kind]}`;
}

export function signalKindDotClass(kind: SnapshotSignalKind) {
  const styles: Record<SnapshotSignalKind, string> = {
    idea: "bg-emerald-400",
    pain: "bg-rose-400",
    risk: "bg-orange-400",
    hypothesis: "bg-violet-400",
    insight: "bg-blue-400",
    trend: "bg-cyan-400",
    event: "bg-slate-500",
    material: "bg-indigo-400",
    tool: "bg-amber-400",
    place: "bg-pink-400",
    person: "bg-lime-400",
  };

  return styles[kind];
}

export function signalMenuBadgeClass(kind: SnapshotSignalKind | "all") {
  if (kind === "all") {
    return "bg-white text-slate-500";
  }

  const styles: Record<SnapshotSignalKind, string> = {
    idea: "bg-emerald-100 text-emerald-800",
    pain: "bg-rose-100 text-rose-800",
    risk: "bg-orange-100 text-orange-800",
    hypothesis: "bg-violet-100 text-violet-800",
    insight: "bg-blue-100 text-blue-800",
    trend: "bg-cyan-100 text-cyan-800",
    event: "bg-slate-200 text-slate-800",
    material: "bg-indigo-100 text-indigo-800",
    tool: "bg-amber-100 text-amber-800",
    place: "bg-pink-100 text-pink-800",
    person: "bg-lime-100 text-lime-800",
  };

  return styles[kind];
}

export function visibleSignalTags(signal: SnapshotSignal) {
  return (signal.tags ?? []).filter((tag) => {
    const trimmed = tag.trim();

    return Boolean(trimmed) &&
      !structuralTags.has(trimmed.toLowerCase()) &&
      trimmed.length <= 24 &&
      trimmed.split(/\s+/).length <= 3;
  });
}

export function avatarClass(signal: SnapshotSignal) {
  if (signal.kind !== "person") return "";

  return "grid h-11 w-11 flex-none place-items-center rounded-full bg-gradient-to-br from-emerald-700 to-lime-300 text-sm font-black text-white shadow-inner ring-2 ring-white/40";
}

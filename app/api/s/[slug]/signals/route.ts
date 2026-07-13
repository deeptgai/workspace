import { NextResponse } from "next/server";
import type { SnapshotSignalKind } from "../../../../../src/snapshots/sourceSnapshotSchema";
import { queryPublicSignalFeed, type SignalFeedSection } from "../../../../s/signalFeed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const signalKinds = new Set<SnapshotSignalKind | "all">([
  "all",
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
]);

type SignalFeedRouteProps = {
  params: Promise<{ slug: string }>;
};

function sectionParam(value: string | null): SignalFeedSection {
  return value && signalKinds.has(value as SnapshotSignalKind | "all")
    ? value as SignalFeedSection
    : "all";
}

function numberParam(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: Request, { params }: SignalFeedRouteProps) {
  const { slug } = await params;
  const url = new URL(request.url);
  const feed = await queryPublicSignalFeed({
    slug,
    section: sectionParam(url.searchParams.get("section")),
    fromDay: numberParam(url.searchParams.get("fromDay")),
    tag: url.searchParams.get("tag"),
    cursor: numberParam(url.searchParams.get("cursor")),
    limit: numberParam(url.searchParams.get("limit")),
  });

  if (!feed) {
    return NextResponse.json({ ok: false, error: "Source not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...feed });
}

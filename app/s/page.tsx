import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sourceSlug } from "../sourceSlug";
import { MiniAppEntryRedirect } from "./MiniAppEntryRedirect";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "DeepTG",
  description: "Открытие карты сигналов.",
};

type SignalMapEntryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeSlug(value: string | string[] | null | undefined): string {
  const rawValue = firstParam(value);

  return rawValue ? sourceSlug(rawValue) : "";
}

function searchParamsString(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        query.append(key, item);
      }
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }

  return query.toString();
}

export default async function SignalMapEntryPage({ searchParams }: SignalMapEntryPageProps) {
  const params = await searchParams;
  const requestedSlug = normalizeSlug(params.tgWebAppStartParam || params.startapp || params.slug);

  if (requestedSlug) {
    const query = searchParamsString(params);

    redirect(`/s/${requestedSlug}${query ? `?${query}` : ""}`);
  }

  return <MiniAppEntryRedirect fallbackSlug="anatoly-tolkit" />;
}

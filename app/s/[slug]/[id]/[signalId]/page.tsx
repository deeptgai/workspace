import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

type SignalPageProps = {
  params: Promise<{ slug: string; id: string; signalId: string }>;
};

export default async function ShortSharedSignalPage({ params }: SignalPageProps) {
  const { slug, signalId } = await params;
  redirect(`/s/${slug}/${encodeURIComponent(signalId)}`);
}

import { notFound } from "next/navigation";
import { prisma } from "../../../../src/db/prisma";
import { exportSourceMarkdown } from "../../../../src/export/sourceMarkdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const exported = await exportSourceMarkdown(prisma, {
      sourceId: id,
    });

    return new Response(exported.markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exported.fileName}"`,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Source not found:")) {
      notFound();
    }

    throw error;
  }
}

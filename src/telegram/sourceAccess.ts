import type { PrismaClient } from "@prisma/client";
import { PAID_SECTION_IDS, paidSectionProduct } from "./starsPayments.ts";

const sourceAccessProducts = PAID_SECTION_IDS.map((sectionId) => paidSectionProduct(sectionId));

export async function findPaidSourceAccess(
  prisma: PrismaClient,
  input: {
    telegramId: bigint;
    sourceId: string;
  },
) {
  return prisma.telegramPurchase.findFirst({
    where: {
      telegramId: input.telegramId,
      sourceId: input.sourceId,
      status: "paid",
      product: {
        in: sourceAccessProducts,
      },
    },
    orderBy: {
      paidAt: "desc",
    },
    select: {
      id: true,
      paidAt: true,
      product: true,
    },
  });
}

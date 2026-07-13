import type { Prisma, PrismaClient } from "@prisma/client";
import { PAID_SECTION_IDS, paidSectionProduct } from "./starsPayments.ts";

const sourceAccessProducts = PAID_SECTION_IDS.map((sectionId) => paidSectionProduct(sectionId));

type TelegramUserProfile = {
  id: number | bigint;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  language_code?: string | null;
};

export async function upsertTelegramUserWithCustomer(
  prisma: PrismaClient,
  input: {
    telegramId: bigint;
    profile?: TelegramUserProfile | null;
  },
) {
  const existingUser = await prisma.telegramUser.findUnique({
    where: {
      telegramId: input.telegramId,
    },
    select: {
      id: true,
      customerId: true,
    },
  });
  const customerId = existingUser?.customerId ?? (await prisma.customer.create({ data: {} })).id;
  const userData = {
    customerId,
    username: input.profile?.username,
    firstName: input.profile?.first_name,
    lastName: input.profile?.last_name,
    languageCode: input.profile?.language_code,
    rawJson: input.profile ? input.profile as Prisma.InputJsonObject : undefined,
  };

  return prisma.telegramUser.upsert({
    where: {
      telegramId: input.telegramId,
    },
    update: userData,
    create: {
      telegramId: input.telegramId,
      ...userData,
    },
  });
}

export async function grantPaidSourceAccess(
  prisma: PrismaClient,
  input: {
    customerId: string;
    sourceId: string;
    provider: string;
    product: string;
    paymentId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  return prisma.sourceAccessGrant.upsert({
    where: {
      customerId_sourceId_scope_status: {
        customerId: input.customerId,
        sourceId: input.sourceId,
        scope: "source",
        status: "active",
      },
    },
    update: {
      provider: input.provider,
      product: input.product,
      paymentId: input.paymentId ?? undefined,
      reason: "purchase",
      expiresAt: null,
      revokedAt: null,
      grantedAt: new Date(),
      metadata: input.metadata as Prisma.InputJsonObject | undefined,
    },
    create: {
      customerId: input.customerId,
      sourceId: input.sourceId,
      scope: "source",
      status: "active",
      provider: input.provider,
      product: input.product,
      paymentId: input.paymentId ?? undefined,
      reason: "purchase",
      metadata: input.metadata as Prisma.InputJsonObject | undefined,
    },
  });
}

export async function findPaidSourceAccess(
  prisma: PrismaClient,
  input: {
    telegramId: bigint;
    sourceId: string;
  },
) {
  const telegramUser = await prisma.telegramUser.findUnique({
    where: {
      telegramId: input.telegramId,
    },
    select: {
      customerId: true,
    },
  });

  if (telegramUser?.customerId) {
    const grant = await prisma.sourceAccessGrant.findFirst({
      where: {
        customerId: telegramUser.customerId,
        sourceId: input.sourceId,
        scope: "source",
        status: "active",
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: {
        grantedAt: "desc",
      },
      select: {
        id: true,
        grantedAt: true,
        product: true,
        payment: {
          select: {
            paidAt: true,
          },
        },
      },
    });

    if (grant) {
      return {
        id: grant.id,
        paidAt: grant.payment?.paidAt ?? grant.grantedAt,
        product: grant.product ?? "source-access",
      };
    }
  }

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

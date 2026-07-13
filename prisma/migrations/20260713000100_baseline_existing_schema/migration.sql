-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT,
    "url" TEXT,
    "audienceCount" INTEGER,
    "metadata" JSONB,
    "paidSignalKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastImportAt" TIMESTAMP(3),

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceImportState" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'content',
    "oldestExternalId" TEXT,
    "newestExternalId" TEXT,
    "cursor" JSONB,
    "metadata" JSONB,
    "lastImportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceImportState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Actor" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "url" TEXT,
    "photo" TEXT,
    "isBot" BOOLEAN,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramUser" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "languageCode" TEXT,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "providerCustomerId" TEXT,
    "product" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAccessGrant" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'source',
    "status" TEXT NOT NULL DEFAULT 'active',
    "provider" TEXT,
    "product" TEXT,
    "paymentId" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'purchase',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramPurchase" (
    "id" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "paymentId" TEXT,
    "telegramId" BIGINT NOT NULL,
    "product" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "currency" TEXT NOT NULL DEFAULT 'XTR',
    "amount" INTEGER NOT NULL,
    "invoicePayload" TEXT NOT NULL,
    "telegramPaymentChargeId" TEXT,
    "providerPaymentChargeId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "actorId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'post',
    "parentId" TEXT,
    "title" TEXT,
    "text" TEXT,
    "url" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "replyToExternalId" TEXT,
    "views" INTEGER,
    "forwards" INTEGER,
    "reactionsTotal" INTEGER NOT NULL DEFAULT 0,
    "reactionCounts" JSONB,
    "repliesCount" INTEGER NOT NULL DEFAULT 0,
    "hasComments" BOOLEAN NOT NULL DEFAULT false,
    "commentsPeerId" TEXT,
    "engagementScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItemFormat" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "formattedText" TEXT NOT NULL,
    "changed" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "notes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItemFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentEmbedding" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "textHash" TEXT NOT NULL,
    "embedding" vector NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSnapshot" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "summary" TEXT,
    "heroTheme" JSONB,
    "coverImage" JSONB,
    "pipeline" JSONB,
    "document" JSONB,
    "error" TEXT,
    "model" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSnapshotSection" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "summary" TEXT,
    "items" JSONB,
    "segments" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceSnapshotSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnapshotSignal" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalSignalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "canonicalClaim" TEXT,
    "fingerprint" TEXT,
    "tags" JSONB,
    "priority" TEXT,
    "score" TEXT,
    "confidence" DOUBLE PRECISION,
    "metrics" JSONB,
    "url" TEXT,
    "person" JSONB,
    "previewImage" JSONB,
    "timeline" JSONB,
    "sortAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolution" JSONB,
    "sourceSignalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnapshotSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnapshotSignalEvidence" (
    "id" TEXT NOT NULL,
    "snapshotSignalId" TEXT NOT NULL,
    "contentItemId" TEXT,
    "itemExternalId" TEXT NOT NULL,
    "quote" TEXT,
    "reason" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnapshotSignalEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSignal" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "canonicalClaim" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "tags" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION,
    "previewImage" JSONB,
    "firstEvidenceAt" TIMESTAMP(3),
    "lastEvidenceAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSignalEvidence" (
    "id" TEXT NOT NULL,
    "sourceSignalId" TEXT NOT NULL,
    "contentItemId" TEXT,
    "snapshotSignalId" TEXT,
    "itemExternalId" TEXT NOT NULL,
    "quote" TEXT,
    "reason" TEXT,
    "confidence" DOUBLE PRECISION,
    "firstSeenSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceSignalEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Source_provider_idx" ON "Source"("provider");

-- CreateIndex
CREATE INDEX "Source_type_idx" ON "Source"("type");

-- CreateIndex
CREATE INDEX "Source_username_idx" ON "Source"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Source_provider_externalId_key" ON "Source"("provider", "externalId");

-- CreateIndex
CREATE INDEX "SourceImportState_provider_idx" ON "SourceImportState"("provider");

-- CreateIndex
CREATE INDEX "SourceImportState_scope_idx" ON "SourceImportState"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "SourceImportState_sourceId_scope_key" ON "SourceImportState"("sourceId", "scope");

-- CreateIndex
CREATE INDEX "Actor_provider_idx" ON "Actor"("provider");

-- CreateIndex
CREATE INDEX "Actor_username_idx" ON "Actor"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Actor_provider_externalId_key" ON "Actor"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramUser_telegramId_key" ON "TelegramUser"("telegramId");

-- CreateIndex
CREATE INDEX "TelegramUser_customerId_idx" ON "TelegramUser"("customerId");

-- CreateIndex
CREATE INDEX "TelegramUser_username_idx" ON "TelegramUser"("username");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE INDEX "Payment_provider_idx" ON "Payment"("provider");

-- CreateIndex
CREATE INDEX "Payment_sourceId_idx" ON "Payment"("sourceId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerPaymentId_key" ON "Payment"("provider", "providerPaymentId");

-- CreateIndex
CREATE INDEX "SourceAccessGrant_customerId_idx" ON "SourceAccessGrant"("customerId");

-- CreateIndex
CREATE INDEX "SourceAccessGrant_sourceId_idx" ON "SourceAccessGrant"("sourceId");

-- CreateIndex
CREATE INDEX "SourceAccessGrant_status_idx" ON "SourceAccessGrant"("status");

-- CreateIndex
CREATE INDEX "SourceAccessGrant_provider_idx" ON "SourceAccessGrant"("provider");

-- CreateIndex
CREATE INDEX "SourceAccessGrant_paymentId_idx" ON "SourceAccessGrant"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceAccessGrant_customerId_sourceId_scope_status_key" ON "SourceAccessGrant"("customerId", "sourceId", "scope", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramPurchase_invoicePayload_key" ON "TelegramPurchase"("invoicePayload");

-- CreateIndex
CREATE INDEX "TelegramPurchase_telegramUserId_idx" ON "TelegramPurchase"("telegramUserId");

-- CreateIndex
CREATE INDEX "TelegramPurchase_paymentId_idx" ON "TelegramPurchase"("paymentId");

-- CreateIndex
CREATE INDEX "TelegramPurchase_telegramId_idx" ON "TelegramPurchase"("telegramId");

-- CreateIndex
CREATE INDEX "TelegramPurchase_sourceId_idx" ON "TelegramPurchase"("sourceId");

-- CreateIndex
CREATE INDEX "TelegramPurchase_status_idx" ON "TelegramPurchase"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramPurchase_telegramId_product_sourceId_status_key" ON "TelegramPurchase"("telegramId", "product", "sourceId", "status");

-- CreateIndex
CREATE INDEX "ContentItem_sourceId_publishedAt_idx" ON "ContentItem"("sourceId", "publishedAt");

-- CreateIndex
CREATE INDEX "ContentItem_sourceId_externalId_idx" ON "ContentItem"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "ContentItem_sourceId_kind_idx" ON "ContentItem"("sourceId", "kind");

-- CreateIndex
CREATE INDEX "ContentItem_parentId_idx" ON "ContentItem"("parentId");

-- CreateIndex
CREATE INDEX "ContentItem_sourceId_engagementScore_idx" ON "ContentItem"("sourceId", "engagementScore");

-- CreateIndex
CREATE INDEX "ContentItem_actorId_idx" ON "ContentItem"("actorId");

-- CreateIndex
CREATE INDEX "ContentItem_provider_idx" ON "ContentItem"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_provider_sourceId_externalId_kind_key" ON "ContentItem"("provider", "sourceId", "externalId", "kind");

-- CreateIndex
CREATE INDEX "ContentItemFormat_itemId_idx" ON "ContentItemFormat"("itemId");

-- CreateIndex
CREATE INDEX "ContentItemFormat_model_idx" ON "ContentItemFormat"("model");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItemFormat_itemId_model_key" ON "ContentItemFormat"("itemId", "model");

-- CreateIndex
CREATE INDEX "ContentEmbedding_model_idx" ON "ContentEmbedding"("model");

-- CreateIndex
CREATE INDEX "ContentEmbedding_itemId_idx" ON "ContentEmbedding"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentEmbedding_itemId_model_key" ON "ContentEmbedding"("itemId", "model");

-- CreateIndex
CREATE INDEX "SourceSnapshot_sourceId_createdAt_idx" ON "SourceSnapshot"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "SourceSnapshot_sourceId_periodFrom_periodTo_idx" ON "SourceSnapshot"("sourceId", "periodFrom", "periodTo");

-- CreateIndex
CREATE INDEX "SourceSnapshot_kind_idx" ON "SourceSnapshot"("kind");

-- CreateIndex
CREATE INDEX "SourceSnapshot_status_idx" ON "SourceSnapshot"("status");

-- CreateIndex
CREATE INDEX "SourceSnapshotSection_snapshotId_status_idx" ON "SourceSnapshotSection"("snapshotId", "status");

-- CreateIndex
CREATE INDEX "SourceSnapshotSection_sectionId_idx" ON "SourceSnapshotSection"("sectionId");

-- CreateIndex
CREATE INDEX "SourceSnapshotSection_status_idx" ON "SourceSnapshotSection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSnapshotSection_snapshotId_sectionId_key" ON "SourceSnapshotSection"("snapshotId", "sectionId");

-- CreateIndex
CREATE INDEX "SnapshotSignal_snapshotId_kind_idx" ON "SnapshotSignal"("snapshotId", "kind");

-- CreateIndex
CREATE INDEX "SnapshotSignal_snapshotId_status_idx" ON "SnapshotSignal"("snapshotId", "status");

-- CreateIndex
CREATE INDEX "SnapshotSignal_sourceId_kind_idx" ON "SnapshotSignal"("sourceId", "kind");

-- CreateIndex
CREATE INDEX "SnapshotSignal_sourceSignalId_idx" ON "SnapshotSignal"("sourceSignalId");

-- CreateIndex
CREATE INDEX "SnapshotSignal_sortAt_idx" ON "SnapshotSignal"("sortAt");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotSignal_snapshotId_externalSignalId_key" ON "SnapshotSignal"("snapshotId", "externalSignalId");

-- CreateIndex
CREATE INDEX "SnapshotSignalEvidence_contentItemId_idx" ON "SnapshotSignalEvidence"("contentItemId");

-- CreateIndex
CREATE INDEX "SnapshotSignalEvidence_itemExternalId_idx" ON "SnapshotSignalEvidence"("itemExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotSignalEvidence_snapshotSignalId_itemExternalId_key" ON "SnapshotSignalEvidence"("snapshotSignalId", "itemExternalId");

-- CreateIndex
CREATE INDEX "SourceSignal_sourceId_kind_idx" ON "SourceSignal"("sourceId", "kind");

-- CreateIndex
CREATE INDEX "SourceSignal_sourceId_status_idx" ON "SourceSignal"("sourceId", "status");

-- CreateIndex
CREATE INDEX "SourceSignal_lastEvidenceAt_idx" ON "SourceSignal"("lastEvidenceAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSignal_sourceId_kind_fingerprint_key" ON "SourceSignal"("sourceId", "kind", "fingerprint");

-- CreateIndex
CREATE INDEX "SourceSignalEvidence_contentItemId_idx" ON "SourceSignalEvidence"("contentItemId");

-- CreateIndex
CREATE INDEX "SourceSignalEvidence_snapshotSignalId_idx" ON "SourceSignalEvidence"("snapshotSignalId");

-- CreateIndex
CREATE INDEX "SourceSignalEvidence_itemExternalId_idx" ON "SourceSignalEvidence"("itemExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSignalEvidence_sourceSignalId_itemExternalId_key" ON "SourceSignalEvidence"("sourceSignalId", "itemExternalId");

-- AddForeignKey
ALTER TABLE "SourceImportState" ADD CONSTRAINT "SourceImportState_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramUser" ADD CONSTRAINT "TelegramUser_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAccessGrant" ADD CONSTRAINT "SourceAccessGrant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAccessGrant" ADD CONSTRAINT "SourceAccessGrant_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAccessGrant" ADD CONSTRAINT "SourceAccessGrant_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramPurchase" ADD CONSTRAINT "TelegramPurchase_telegramUserId_fkey" FOREIGN KEY ("telegramUserId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramPurchase" ADD CONSTRAINT "TelegramPurchase_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItemFormat" ADD CONSTRAINT "ContentItemFormat_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentEmbedding" ADD CONSTRAINT "ContentEmbedding_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSnapshotSection" ADD CONSTRAINT "SourceSnapshotSection_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SourceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotSignal" ADD CONSTRAINT "SnapshotSignal_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SourceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotSignal" ADD CONSTRAINT "SnapshotSignal_sourceSignalId_fkey" FOREIGN KEY ("sourceSignalId") REFERENCES "SourceSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotSignalEvidence" ADD CONSTRAINT "SnapshotSignalEvidence_snapshotSignalId_fkey" FOREIGN KEY ("snapshotSignalId") REFERENCES "SnapshotSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotSignalEvidence" ADD CONSTRAINT "SnapshotSignalEvidence_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSignal" ADD CONSTRAINT "SourceSignal_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSignalEvidence" ADD CONSTRAINT "SourceSignalEvidence_sourceSignalId_fkey" FOREIGN KEY ("sourceSignalId") REFERENCES "SourceSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSignalEvidence" ADD CONSTRAINT "SourceSignalEvidence_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;


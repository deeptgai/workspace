-- CreateTable
CREATE TABLE IF NOT EXISTS "SourceAnalysisState" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "lastAnalyzedContentCreatedAt" TIMESTAMP(3),
    "lastAnalyzedPublishedAt" TIMESTAMP(3),
    "lastAnalyzedExternalId" TEXT,
    "lastSnapshotId" TEXT,
    "cursor" JSONB,
    "metadata" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceAnalysisState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SourceAnalysisState_sourceId_key" ON "SourceAnalysisState"("sourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SourceAnalysisState_provider_idx" ON "SourceAnalysisState"("provider");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SourceAnalysisState_lastAnalyzedContentCreatedAt_idx" ON "SourceAnalysisState"("lastAnalyzedContentCreatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SourceAnalysisState_lastAnalyzedPublishedAt_idx" ON "SourceAnalysisState"("lastAnalyzedPublishedAt");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'SourceAnalysisState_sourceId_fkey'
    ) THEN
        ALTER TABLE "SourceAnalysisState"
        ADD CONSTRAINT "SourceAnalysisState_sourceId_fkey"
        FOREIGN KEY ("sourceId") REFERENCES "Source"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Backfill analysis cursors from the latest completed snapshot per source.
-- Only content covered by that snapshot is marked as analyzed.
WITH latest_snapshot AS (
    SELECT DISTINCT ON ("sourceId")
        "id",
        "sourceId",
        "periodTo"
    FROM "SourceSnapshot"
    WHERE "status" = 'completed'
    ORDER BY "sourceId", "completedAt" DESC NULLS LAST, "createdAt" DESC
),
content_bounds AS (
    SELECT
        latest_snapshot."sourceId",
        max(content_item."createdAt") AS "lastAnalyzedContentCreatedAt",
        max(content_item."publishedAt") AS "lastAnalyzedPublishedAt"
    FROM latest_snapshot
    LEFT JOIN "ContentItem" content_item
        ON content_item."sourceId" = latest_snapshot."sourceId"
        AND (
            latest_snapshot."periodTo" IS NULL
            OR content_item."publishedAt" <= latest_snapshot."periodTo"
        )
    GROUP BY latest_snapshot."sourceId"
),
latest_content AS (
    SELECT DISTINCT ON (content_item."sourceId")
        content_item."sourceId",
        content_item."externalId"
    FROM "ContentItem" content_item
    JOIN latest_snapshot
        ON latest_snapshot."sourceId" = content_item."sourceId"
        AND (
            latest_snapshot."periodTo" IS NULL
            OR content_item."publishedAt" <= latest_snapshot."periodTo"
        )
    ORDER BY content_item."sourceId", content_item."publishedAt" DESC, content_item."externalId" DESC
)
INSERT INTO "SourceAnalysisState" (
    "id",
    "sourceId",
    "provider",
    "lastAnalyzedContentCreatedAt",
    "lastAnalyzedPublishedAt",
    "lastAnalyzedExternalId",
    "lastSnapshotId",
    "cursor",
    "metadata",
    "completedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'sast_' || substring(md5(source."id") for 24),
    source."id",
    source."provider",
    content_bounds."lastAnalyzedContentCreatedAt",
    COALESCE(latest_snapshot."periodTo", content_bounds."lastAnalyzedPublishedAt"),
    latest_content."externalId",
    latest_snapshot."id",
    jsonb_build_object(
        'bootstrappedFromSnapshotId', latest_snapshot."id",
        'lastAnalyzedContentCreatedAt', content_bounds."lastAnalyzedContentCreatedAt",
        'lastAnalyzedPublishedAt', COALESCE(latest_snapshot."periodTo", content_bounds."lastAnalyzedPublishedAt"),
        'updatedAt', CURRENT_TIMESTAMP
    ),
    jsonb_build_object(
        'bootstrap', true,
        'source', 'migration'
    ),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM latest_snapshot
JOIN "Source" source ON source."id" = latest_snapshot."sourceId"
LEFT JOIN content_bounds ON content_bounds."sourceId" = latest_snapshot."sourceId"
LEFT JOIN latest_content ON latest_content."sourceId" = latest_snapshot."sourceId"
WHERE
    content_bounds."lastAnalyzedContentCreatedAt" IS NOT NULL
    OR COALESCE(latest_snapshot."periodTo", content_bounds."lastAnalyzedPublishedAt") IS NOT NULL
ON CONFLICT ("sourceId") DO NOTHING;

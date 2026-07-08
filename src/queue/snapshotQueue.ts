import { Queue } from "bullmq";

export type SourceSnapshotJobData = {
  chat: string;
  snapshotId?: string;
};

function redisConnectionOptions() {
  const url = new URL(process.env.REDIS_URL || "redis://localhost:6379");

  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
  };
}

function slug(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9а-яё_-]+/giu, "-");
}

function uniqueJobId(prefix: string, chat: string): string {
  return `${slug(prefix)}--${slug(chat)}--${Date.now()}--${Math.random().toString(36).slice(2, 8)}`;
}

export async function enqueueSourceSnapshotJob(data: SourceSnapshotJobData) {
  const queue = new Queue<SourceSnapshotJobData, unknown, string>("source-snapshot", {
    connection: redisConnectionOptions(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  });

  try {
    return await queue.add("snapshot", data, {
      jobId: uniqueJobId("snapshot", data.chat),
    });
  } finally {
    await queue.close();
  }
}

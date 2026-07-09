const snapshotUpdateLocks = new Map<string, Promise<void>>();

export async function withSnapshotDocumentUpdateLock<T>(snapshotId: string, action: () => Promise<T>) {
  const previous = snapshotUpdateLocks.get(snapshotId) ?? Promise.resolve();
  let release!: () => void;
  const currentLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.catch(() => undefined).then(() => currentLock);

  snapshotUpdateLocks.set(snapshotId, current);
  await previous.catch(() => undefined);

  try {
    return await action();
  } finally {
    release();

    if (snapshotUpdateLocks.get(snapshotId) === current) {
      snapshotUpdateLocks.delete(snapshotId);
    }
  }
}

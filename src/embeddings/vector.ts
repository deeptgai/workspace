export function toPgVectorLiteral(vector: number[]): string {
  if (vector.length === 0) {
    throw new Error("Cannot serialize an empty vector.");
  }

  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new Error("Embedding vector contains a non-finite value.");
    }
  }

  return `[${vector.join(",")}]`;
}

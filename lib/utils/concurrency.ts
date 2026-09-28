/**
 * Maps `items` through `fn` with at most `limit` concurrent executions,
 * preserving order. Rejections propagate after all workers settle their
 * current item — callers that need per-item error handling should catch
 * inside `fn`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

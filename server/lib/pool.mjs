/** Run `fn` over `items` with at most `size` in flight. */
export async function pool(items, size, fn) {
  const queue = [...items];
  const worker = async () => { while (queue.length) await fn(queue.shift()); };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

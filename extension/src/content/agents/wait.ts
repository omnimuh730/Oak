export async function waitMs(ms: number | null): Promise<number> {
  const delay = typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, ms) : 500;
  await new Promise((resolve) => setTimeout(resolve, delay));
  return delay;
}

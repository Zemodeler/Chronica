/**
 * Runs once when the server starts (Next's instrumentation hook): clears the
 * bursts and coin holds a previous server left behind (`orphan-sweep.ts`).
 * Only in the Node runtime, and only with a database configured.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const url = process.env.DATABASE_URL?.trim();
  if (url === undefined || url.length === 0) return;
  const { scheduleOrphanSweeps } = await import("./lib/orphan-sweep");
  scheduleOrphanSweeps(url);
}

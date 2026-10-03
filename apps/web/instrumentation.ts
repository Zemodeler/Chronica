/**
 * Runs once when the server starts (Next's instrumentation hook): clears the
 * bursts and coin holds a previous server left behind (`orphan-sweep.ts`).
 * Only in the Node runtime, and only with a database configured.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.CHRONICA_AI_MODE !== "mock" && process.env.CHRONICA_HAND_RESPONDER !== "manual") {
    const { getSelectedLocalAiProvider, prepareHandCodex } = await import("@chronica/ai");
    if (getSelectedLocalAiProvider() === "codex" || (process.env.CHRONICA_AI_MODE === "hand" && process.env.NODE_ENV === "production")) await prepareHandCodex();
  }
  const url = process.env.DATABASE_URL?.trim();
  if (url === undefined || url.length === 0) return;
  const { scheduleOrphanSweeps } = await import("./lib/orphan-sweep");
  scheduleOrphanSweeps(url);
}

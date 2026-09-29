/**
 * A save that will not open, said as such.
 *
 * `getWorldView` throws `SaveNeedsRepairError` for a stored world that no
 * upgrade can bring to the schema, and `ScenarioDefinitionUnreadableError`
 * for rules the game is pinned to that this build cannot read. Either used
 * to reach the player as a bare 500 -- or, for the rules, as "This scenario
 * declares no clock." Matched by name, so the check holds across the
 * package boundary however the classes were bundled.
 */

export const SAVE_NEEDS_REPAIR = "This save needs repair before it can be played. Nothing has been changed; the details are in the server log.";

/** The player-facing sentence for an unopenable save, or null for any other error. */
export function unopenableSave(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const name = (error as { name?: unknown }).name;
  return name === "SaveNeedsRepairError" || name === "ScenarioDefinitionUnreadableError" ? SAVE_NEEDS_REPAIR : null;
}

/**
 * Runs a read that opens a save, and answers an unopenable one with a 503 and
 * the sentence above instead of a 500. Everything else is thrown on.
 */
export async function orSaveNeedsRepair(gameId: string, read: () => Promise<Response>): Promise<Response> {
  try {
    return await read();
  } catch (error) {
    const message = unopenableSave(error);
    if (message === null) throw error;
    console.error(`[game ${gameId}] ${error instanceof Error ? error.message : String(error)}`);
    return Response.json({ error: message, needsRepair: true }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

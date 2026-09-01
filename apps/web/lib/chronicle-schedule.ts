import type { ScenarioClock } from "@chronica/shared";
import { projectDateLabelAtElapsedDays } from "./world-view";

interface ScheduledChronicleEntry {
  readonly atStep: number;
}

/**
 * Give each entry in one resolved turn a unique day. Entries are already in
 * simulation order (short actions first), so their dates preserve that order.
 * This is presentation metadata only: the authoritative world still advances
 * in whole scenario steps.
 */
export function projectChronicleDateLabel(
  entry: ScheduledChronicleEntry,
  position: number,
  entryCount: number,
  clock: ScenarioClock,
): string {
  const total = Math.max(1, entryCount);
  const daysPerStep = 365 / clock.stepsPerYear;
  const turnStart = Math.floor(Math.max(0, entry.atStep - 1) * daysPerStep);
  const turnEnd = Math.floor(entry.atStep * daysPerStep);
  const turnDays = Math.max(total, turnEnd - turnStart);
  const dayOffset = Math.floor(((Math.max(0, position) + 1) * (turnDays + 1)) / (total + 1));

  if (clock.epoch === undefined) return `Step ${entry.atStep}, day ${dayOffset}`;
  return projectDateLabelAtElapsedDays(turnStart + dayOffset, clock);
}

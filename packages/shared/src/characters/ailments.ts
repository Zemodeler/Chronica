import { INJURY_STATUS_PREFIX } from "./injury";

/**
 * Illnesses and hurts the world writes as words.
 *
 * `character_state_set` takes any status at all, and the engine clears only
 * the ones it manages itself ("incapacitated", by `mortality.ts`). So when the
 * world wrote "severe fever" on the consul Blasio, the fever never broke: he
 * was barred from every office and every plan for ever after, and laid plan
 * upon plan to "resume his duties when recovered". An ailment written this way
 * lasts `AILMENT_DAYS` unless it is written again.
 */
export const AILMENT = /(fever|ill|sick|ague|plague|pox|flux|cough|wound|injur|hurt|exhaust|fatigue|grief|melancholy|malaria|dysentery)/i;

/** How long an ailment written as a word lasts before it passes. */
export const AILMENT_DAYS = 30;

/** Statuses the engine keeps and ends itself, never lapsed as ailments. */
const MANAGED = new Set(["incapacitated", "captured", "hostage", "deserter", "enslaved", "exiled", "outlawed"]);

/**
 * A wound the engine gave (`injury.ts`) is for life, whatever its name says:
 * "injured:lost-arm" matched the words for a passing hurt, and the arm grew
 * back within the month.
 */
export const isAilment = (status: string): boolean =>
  !MANAGED.has(status.trim().toLowerCase()) && !status.startsWith(INJURY_STATUS_PREFIX) && AILMENT.test(status);

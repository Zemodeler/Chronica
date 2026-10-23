import { stableHash } from "@chronica/shared";

/**
 * A local id built from the ids of people and things.
 *
 * A local id is lowercase letters, digits, underscores and hyphens, sixty at
 * most; the ids of the world are not: a child born in the story is
 * `child:rome-kin-3ualq2:21`, a comrade is `titus-vettius:comrade:4`. A local
 * id built by pasting such an id in killed the whole burst with a schema
 * error. This leaves a valid id alone and mends any other: the strange
 * characters become underscores, and one that is too long is cut with a short
 * hash of the whole so that two long ones do not become one.
 */
export function safeLocalId(raw: string): string {
  const mended = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  if (mended.length > 0 && mended.length <= 60) return mended;
  if (mended.length === 0) return "x";
  return `${mended.slice(0, 50)}_${(stableHash([raw]) % 0xffffff).toString(36)}`.slice(0, 60);
}

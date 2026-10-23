/**
 * The save the home page goes back to: the one last played, not the one last
 * made. A second save, begun and left, was featured over the older one the
 * player had just been in.
 */
export interface PlayedSave {
  readonly createdAt?: Date | undefined;
  readonly lastPlayedAt?: Date | null | undefined;
}

/** Most recently played first; a save never played counts from the day it was made; ties keep their order. */
export function savesByLastPlayed<T extends PlayedSave>(saves: readonly T[]): T[] {
  const when = (save: T): number => (save.lastPlayedAt ?? save.createdAt)?.getTime() ?? 0;
  return saves.map((save, index) => ({ save, index })).sort((a, b) => when(b.save) - when(a.save) || a.index - b.index).map(({ save }) => save);
}

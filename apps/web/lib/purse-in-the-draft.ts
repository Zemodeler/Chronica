/**
 * The confirmation draft names the purse the model asked for ("30000
 * drachmae of your own"); the engine holds it to what a man of that standing
 * could have, and the card beside the draft said 2,500. The draft is made to
 * say the purse the character will in fact open with.
 */
export function purseInTheDraft(draft: string | null | undefined, said: number, real: number): string | null | undefined {
  if (draft === null || draft === undefined || said === real) return draft;
  const number = (value: number): string => value.toLocaleString("en-US");
  const spellings = [...new Set([String(said), number(said), number(said).replace(/,/g, " ")])];
  return spellings.reduce((text, spelling) => text.split(spelling).join(number(real)), draft);
}

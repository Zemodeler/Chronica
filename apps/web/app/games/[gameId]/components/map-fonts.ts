/**
 * The face the map writes its names in.
 *
 * Region names are letterspaced Alegreya SC, as an atlas would set them. The
 * page loads it through next/font, which gives it a generated family name, so
 * the canvas asks the stylesheet what that name is rather than guessing.
 *
 * Canvas text drawn before a web font arrives is drawn in the fallback and
 * stays that way in any bitmap made from it. `whenLabelFontReady` lets the
 * label cache throw those bitmaps away once the real face is in.
 */

const FALLBACK = 'Georgia, "Times New Roman", serif';

let family: string | null = null;
let ready = false;
let loading: Promise<void> | null = null;
const waiting = new Set<() => void>();

export function labelFontFamily(): string {
  if (family !== null) return family;
  if (typeof document === "undefined") return FALLBACK;
  const declared = getComputedStyle(document.documentElement).getPropertyValue("--font-alegreya-sc").trim();
  family = declared.length > 0 ? `${declared}, ${FALLBACK}` : FALLBACK;
  return family;
}

/** True once the label face has loaded; until then, calls back when it does. */
export function whenLabelFontReady(onReady: () => void): boolean {
  if (ready) return true;
  if (typeof document === "undefined" || !("fonts" in document)) return true;
  // Asked every frame until then; each caller is told once.
  waiting.add(onReady);
  loading ??= Promise.all([
    document.fonts.load(`400 16px ${labelFontFamily()}`),
    document.fonts.load(`500 16px ${labelFontFamily()}`),
  ]).then(() => undefined, () => undefined).then(() => {
    ready = true;
    for (const callback of waiting) callback();
    waiting.clear();
  });
  return false;
}

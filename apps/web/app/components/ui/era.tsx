import { Fragment, type ReactNode } from "react";

/**
 * A date as a book would set it: "270 BC" with the era in small caps.
 *
 * Alegreya SC draws lowercase as small capitals, so `.era` sets the era in
 * that face and lowers it with text-transform. The text itself is untouched,
 * so a screen reader still reads "BC".
 */
const ERA = /\b(BCE|BC|CE|AD)\b/g;

export function Era({ text }: { readonly text: string }): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(ERA)) {
    const at = match.index;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(<span key={at} className="era">{match[0]}</span>);
    last = at + match[0].length;
  }
  if (last === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}

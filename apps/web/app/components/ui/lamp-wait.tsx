import type { ReactNode } from "react";

/**
 * One lamp, burning, while the world is fetched or a character is written
 * into it. The flame is the page's only motion, and it stops for anyone who
 * asks for reduced motion.
 */
export function LampWait({ kicker, name, note }: { readonly kicker?: ReactNode; readonly name?: ReactNode; readonly note: ReactNode }) {
  return (
    <div className="lamp-wait" role="status" aria-live="polite">
      <div className="lamp-wait__flame" aria-hidden="true" />
      <div>
        {kicker !== undefined && <p className="lamp-wait__kicker">{kicker}</p>}
        {name !== undefined && <h1 className="lamp-wait__name">{name}</h1>}
        <p className="lamp-wait__note">{note}</p>
      </div>
    </div>
  );
}

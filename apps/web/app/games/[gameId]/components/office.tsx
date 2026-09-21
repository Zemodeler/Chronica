"use client";

/**
 * The Office: the player's own room.
 *
 * The game is two places now. The Map is the world seen from outside; this is
 * where the player works, and where everything about their own position
 * finally has somewhere to live. Before it, every surface in the game was a
 * fixed-position button bolted to the left edge of the map at a hard-coded
 * offset -- `top: calc(8rem + 44px + 0.75rem)` -- and there was no room for a
 * sixth.
 *
 * This is the plain version: a list of the things in the room. The drawn room
 * comes over the top of exactly this structure and changes nothing about what
 * is reachable or how, which is the point of building it in this order. The
 * list is also the accessible layer, and stays so once there is scenery: a
 * drawing carries no tab order, no focus and no names.
 */

export type OfficeSurface =
  | "council" | "chronicle" | "books" | "purse"
  | "forces" | "standing" | "people" | "self";

export interface OfficeThing {
  readonly id: OfficeSurface;
  readonly name: string;
  /** What you do here, in one line. */
  readonly does: string;
  /** How many of something want attention, if any. */
  readonly badge?: number | undefined;
  /** Something is waiting on the player's word. */
  readonly marked?: boolean | undefined;
}

export function Office({
  things,
  onOpen,
  onLeave,
}: {
  readonly things: readonly OfficeThing[];
  readonly onOpen: (surface: OfficeSurface) => void;
  readonly onLeave: () => void;
}) {
  return (
    <div className="office" id="place-office" role="tabpanel" aria-label="Your office">
      <div className="office__room">
        <ul className="office__objects">
          {things.map((thing) => (
            <li key={thing.id}>
              <button
                type="button"
                className="office-object"
                data-object={thing.id}
                onClick={() => onOpen(thing.id)}
              >
                <span className="office-object__name">{thing.name}</span>
                <span className="office-object__does">{thing.does}</span>
                {thing.marked === true && <span className="office-object__mark" aria-label="Waiting on your word">•</span>}
                {thing.badge !== undefined && thing.badge > 0 && (
                  <span className="office-object__badge">{thing.badge}</span>
                )}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="office-object" data-object="window" onClick={onLeave}>
              <span className="office-object__name">The window</span>
              <span className="office-object__does">Look out at the world.</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

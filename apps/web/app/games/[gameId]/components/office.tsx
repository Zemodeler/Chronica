"use client";

import { useState } from "react";
import {
  OFFICE_OBJECTS, ROOM_HEIGHT, ROOM_WIDTH,
  type OfficeObjectId, type RoomStyle,
} from "./office-objects";
import { rectFor, sceneryFor } from "./office-scenery";

/**
 * The Office: the player's own room.
 *
 * The game is two places now. The Map is the world seen from outside; this is
 * where the player works. Before it, every surface was a fixed-position
 * button bolted to the left edge of the map at a hard-coded offset, and there
 * was no room for a sixth.
 *
 * Three layers, deliberately separable, because the art is meant to be
 * replaced (see `office-scenery.ts`):
 *
 *   - the scenery, which is a picture and nothing else: aria-hidden, inert,
 *     no text, no handlers;
 *   - the controls, real buttons positioned from `office-objects.ts`;
 *   - the same controls as a plain list, when there is no picture.
 *
 * The controls are one list in one order either way, so the tab order, the
 * focus behaviour and what a screen reader says do not depend on the art at
 * all. That is the whole reason the picture is allowed to be swapped without
 * anybody re-testing the room.
 */

export type OfficeSurface = OfficeObjectId;

export interface OfficeThing {
  readonly id: OfficeSurface;
  /** How many of something want attention, if any. */
  readonly badge?: number | undefined;
  /** Something is waiting on the player's word. */
  readonly marked?: boolean | undefined;
  /** The drawing shows this differently: an empty strongbox, a thinned rack. */
  readonly state?: string | undefined;
}

export function Office({
  things,
  style,
  onOpen,
  onLeave,
}: {
  readonly things: readonly OfficeThing[];
  readonly style: RoomStyle;
  readonly onOpen: (surface: OfficeSurface) => void;
  readonly onLeave: () => void;
}) {
  const [hot, setHot] = useState<OfficeObjectId | null>(null);
  const scenery = sceneryFor(style);
  const present = new Map(things.map((thing) => [thing.id, thing]));

  // Reading order is the array's order, always, so the room reads the same
  // whether or not it is drawn.
  const shown = OFFICE_OBJECTS.filter((object) => object.id === "window" || present.has(object.id));
  const drawn = scenery.kind === "image";

  return (
    <div
      className="office"
      id="place-office"
      role="tabpanel"
      aria-labelledby="place-office-tab"
      data-style={style}
      data-scenery={scenery.kind}
    >
      <div className="office__room">
        {drawn && (
          <img
            className="office__scenery"
            src={scenery.src}
            alt=""
            aria-hidden="true"
            draggable={false}
            width={ROOM_WIDTH}
            height={ROOM_HEIGHT}
          />
        )}
        {!drawn && <div className="office__scenery office__scenery--drawn" aria-hidden="true" />}

        <ul className={drawn ? "office__objects office__objects--placed" : "office__objects"}>
          {shown.map((object) => {
            const thing = present.get(object.id);
            const rect = rectFor(scenery, object.id, object.rect);
            return (
              <li
                key={object.id}
                style={drawn ? {
                  // viewBox units to percentages: the frame is aspect-locked,
                  // so this needs no measurement and no resize listener.
                  left: `${(rect.x / ROOM_WIDTH) * 100}%`,
                  top: `${(rect.y / ROOM_HEIGHT) * 100}%`,
                  width: `${(rect.w / ROOM_WIDTH) * 100}%`,
                  height: `${(rect.h / ROOM_HEIGHT) * 100}%`,
                } : undefined}
              >
                <button
                  type="button"
                  className="office-object"
                  data-object={object.id}
                  data-hot={hot === object.id ? "true" : undefined}
                  data-state={thing?.state}
                  aria-description={object.does}
                  onPointerEnter={() => setHot(object.id)}
                  onPointerLeave={() => setHot((current) => (current === object.id ? null : current))}
                  onFocus={() => setHot(object.id)}
                  onBlur={() => setHot((current) => (current === object.id ? null : current))}
                  onClick={() => (object.id === "window" ? onLeave() : onOpen(object.id))}
                >
                  <span className="office-object__name">{object.name}</span>
                  <span className="office-object__does">{object.does}</span>
                  {thing?.marked === true && <span className="office-object__mark" aria-label="Waiting on your word">•</span>}
                  {thing?.badge !== undefined && thing.badge > 0 && (
                    <span className="office-object__badge">{thing.badge}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

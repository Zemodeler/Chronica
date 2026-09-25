import { z } from "zod";
import { EntityIdSchema } from "../material-state";

/**
 * A narrow, reusable "who or what" reference -- who holds an authority
 * grant, what an authority order attempt targets, what a generic entity or
 * project is tied to. Originally lived alongside the (now-removed) Orders
 * feature in `actions/orders.ts`, but its actual usage was always this
 * generic reference shape reused across authority, facts, and world-entity
 * modules, not anything specific to orders -- so it survives here.
 */
export const OrderPartyRefSchema = z
  .object({
    kind: z.enum([
      "character", "faction", "polity", "institution", "force", "province", "settlement", "account", "office", "procedure",
      // A project is as much a thing an event affects as a force is; without it
      // the simulation could not say that a fact concerned an ongoing effort.
      "project",
      /** A thread of history is a thing a fact can be about, now that the world follows them. */
      "storyline",
      "region", "theatre", "world",
    ]),
    id: EntityIdSchema,
  })
  .strict()
  .meta({ id: "PartyRef" });
export type OrderPartyRef = z.infer<typeof OrderPartyRefSchema>;

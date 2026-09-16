import { z } from "zod";
import { EntityIdSchema } from "../material-state";

/**
 * The authority vocabulary, as a leaf module.
 *
 * Split out of `authority-grant.ts` so both that module and the simulation's
 * delta union (`sim/deltas.ts`) can name a domain without importing each other:
 * deltas are classified *by* domain, and offices derive authority *from* the
 * delta vocabulary, so the two would otherwise form a cycle.
 */

export const AuthoritySourceSchema = z.enum(["office", "law", "command", "delegation", "custom", "conquest", "emergency"]);
export type AuthoritySource = z.infer<typeof AuthoritySourceSchema>;

export const AuthorityDomainSchema = z.enum(["military", "civil", "fiscal", "judicial", "diplomatic", "religious", "social"]);
export type AuthorityDomain = z.infer<typeof AuthorityDomainSchema>;

export const AuthorityScopeKindSchema = z.enum(["force", "settlement", "province", "region", "polity", "institution", "account"]);
export type AuthorityScopeKind = z.infer<typeof AuthorityScopeKindSchema>;

export const AuthorityScopeSchema = z.object({ kind: AuthorityScopeKindSchema, id: EntityIdSchema }).strict();
export type AuthorityScope = z.infer<typeof AuthorityScopeSchema>;

export const AuthorityPowerSchema = z.enum(["command", "spend", "propose", "appoint", "negotiate", "punish", "override"]);
export type AuthorityPower = z.infer<typeof AuthorityPowerSchema>;

export const AuthorityStandingSchema = z.enum(["lawful", "delegated", "de_facto", "disputed", "usurped", "emergency"]);
export type AuthorityStanding = z.infer<typeof AuthorityStandingSchema>;

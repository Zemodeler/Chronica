import { buildAuthorityIndex, isActive, type AuthorityGrant } from "./authority-grant";
import type { OrderStanding } from "./order-attempt";
import { allOffices, type Office } from "../characters/character";
import type { OrderPartyRef } from "../world/party-ref";
import type { WorldState } from "../world/world-state";

/**
 * Whether the person giving this order had any standing to give it.
 *
 * Every delegation the engine has ever recorded said `authorized: true`. It was
 * a constant in `recordDelegations`, so a merchant's request to a legate and a
 * consul's command to the same man were indistinguishable in the record, and
 * the recipient's own prompt was told "lawful: true" about both. Nobody has
 * ever refused anybody, partly because nobody was ever told they could.
 *
 * ## Why this does not call `checkAuthority`
 *
 * The obvious implementation is to ask the authority index whether the issuer
 * may perform `order_attempt_decide` over the recipient's polity. It would be
 * wrong, and wrong in the direction this codebase keeps being wrong in: no
 * scenario office authorises that operation, so a consul ordering his own
 * legate would come back unauthorised and the record would show a lawful
 * command as presumption. That is the ninth way this check has found to
 * manufacture insubordination out of a government doing its ordinary business.
 *
 * So this asks the different question it actually needs: does this person hold
 * something that *reaches* that person. Three ways it can, and then two
 * defaults.
 */

export interface OrderStandingInput {
  readonly world: WorldState;
  readonly offices: readonly Office[];
  readonly issuerRef: OrderPartyRef;
  readonly recipientRef: OrderPartyRef;
}

export interface OrderStandingVerdict {
  readonly standing: OrderStanding;
  /** The grant it rests on, where it rests on one. */
  readonly grant: AuthorityGrant | null;
  /** Written for the recipient's own prompt, not for an audit. */
  readonly reason: string;
}

export function assessOrderStanding(input: OrderStandingInput): OrderStandingVerdict {
  const { world, issuerRef, recipientRef } = input;
  const offices = allOffices(world, input.offices);
  const name = (id: string): string => world.characters.find((character) => character.id === id)?.name ?? id;

  if (issuerRef.kind !== "character" || recipientRef.kind !== "character") {
    return { standing: "requested", grant: null, reason: "They are being asked, not commanded." };
  }
  const issuer = world.characters.find((character) => character.id === issuerRef.id);
  const recipient = world.characters.find((character) => character.id === recipientRef.id);
  if (issuer === undefined || recipient === undefined) {
    return { standing: "requested", grant: null, reason: "They are being asked, not commanded." };
  }

  const index = buildAuthorityIndex(world.material, world.authorityGrants, offices, world.elapsedStep);
  const issuerGrants = index.grants.filter(
    (grant) => grant.holder.kind === "character" && grant.holder.id === issuerRef.id && isActive(grant, world.elapsedStep),
  );
  const officeOf = (characterId: string): Office | undefined => {
    const seat = world.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId === characterId);
    return seat === undefined ? undefined : offices.find((office) => office.id === seat.officeId);
  };
  const issuerOffice = officeOf(issuerRef.id);
  const title = issuerOffice === undefined ? name(issuerRef.id) : `${name(issuerRef.id)}, ${issuerOffice.label}`;

  // 1. They hold the army this man commands. The plainest chain there is.
  const commanded = world.material.forces.find(
    (force) => force.commanderCharacterId === recipientRef.id && force.controllerCharacterId === issuerRef.id,
  );
  if (commanded !== undefined) {
    return { standing: "binding", grant: null, reason: `${title}, who holds the army you command.` };
  }

  // 2. A standing grant somebody actually wrote, reaching this man's power.
  const overTheirPower = issuerGrants.find(
    (grant) => grant.scope.kind === "polity"
      && grant.scope.id === recipient.polityId
      && (grant.powers.includes("command") || grant.powers.includes("override")),
  );
  if (overTheirPower !== undefined) {
    return { standing: "binding", grant: overTheirPower, reason: `${title}, under whom you serve.` };
  }

  // 3. A magistrate of their own power, over somebody holding no office. The
  //    ordinary case: a consul and a quartermaster.
  if (
    issuerOffice !== undefined
    && issuerOffice.polityId === recipient.polityId
    && officeOf(recipientRef.id) === undefined
  ) {
    return { standing: "binding", grant: null, reason: `${title}, a magistrate of your own power.` };
  }

  // 4. Their own countryman, with nothing over them. They may ask.
  if (issuer.polityId !== null && issuer.polityId === recipient.polityId) {
    return { standing: "requested", grant: null, reason: `${title}. He has no authority over you: he is asking.` };
  }

  // 5. A foreigner. He has no business giving you orders at all, and doing as
  //    he says is a private arrangement rather than obedience.
  return { standing: "presumptuous", grant: null, reason: `${title}, of another power entirely. He has no business commanding you.` };
}

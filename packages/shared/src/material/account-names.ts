import type { WorldState } from "../world/world-state";

type Account = WorldState["material"]["accounts"][number];

/**
 * An account, named the way a reader would name it: a power's treasury, a
 * person's purse, an army's pay chest, an arrangement's fund.
 *
 * Every place that named an account used to look its owner up among the
 * characters and, finding nobody, print the owner's id -- so the consul's
 * treasury panel listed "roman-field-army's purse". Owners are of four
 * kinds, and each is named from where that kind keeps its name. When even
 * that fails, the answer is a description, never an id.
 *
 * `heading` is for a list ("Pay chest of the Roman field army"); `clause`
 * is for the middle of a sentence ("paid from the pay chest of the Roman
 * field army").
 */
export function accountLabel(world: WorldState, account: Account, form: "heading" | "clause" = "heading"): string {
  const said = namedAccount(world, account);
  return form === "clause" ? said.clause : said.heading;
}

function namedAccount(world: WorldState, account: Account): { heading: string; clause: string } {
  const { kind, id } = account.owner;
  switch (kind) {
    case "polity": {
      const name = world.map.polities.find((polity) => polity.id === id)?.name;
      return name === undefined
        ? { heading: "A treasury", clause: "a treasury" }
        : { heading: `${name} treasury`, clause: `the ${name} treasury` };
    }
    case "character": {
      const name = world.characters.find((character) => character.id === id)?.name;
      return name === undefined
        ? { heading: "A private purse", clause: "a private purse" }
        : { heading: `${name}'s purse`, clause: `${name}'s purse` };
    }
    case "force": {
      const name = world.material.forces.find((force) => force.id === id)?.name;
      if (name === undefined) return { heading: "An army's pay chest", clause: "an army's pay chest" };
      // "The Sacred Band" is still "the pay chest of the Sacred Band".
      const bare = name.replace(/^the\s+/i, "");
      return { heading: `Pay chest of the ${bare}`, clause: `the pay chest of the ${bare}` };
    }
    case "entity": {
      const label = world.genericEntities.find((entity) => entity.id === id)?.label;
      return label === undefined
        ? { heading: "A private fund", clause: "a private fund" }
        : { heading: `Fund of ${label}`, clause: `the fund of ${label}` };
    }
  }
}

/**
 * The scenario v34 migration of a save under way: every power that holds ground
 * gets its ruler seated by name, a league its commander of horse, and anybody
 * still called by his title a name (`seatFoundingPeopleInto`). Letters written
 * to the Roman "Hiero II" the contact search made go to Hieron II.
 *
 *   tsx --env-file=.env.local scripts/migrate-save-v34.mts <gameId>          # dry run: prints what would change
 *   BACKUP_DIR=<dir> tsx --env-file=.env.local scripts/migrate-save-v34.mts <gameId> --apply  # writes it, after saving a backup
 */
import { writeFileSync } from "node:fs";
import { createDatabase, getWorldView, persistRepairedWorld, punicWarsFounding, romanSenators, seatFoundingPeopleInto, withFinerSkills } from "@chronica/db";
import { WorldStateSchema, findWorldReferenceViolations, spelledAlike, type WorldState } from "@chronica/shared";

async function main(): Promise<void> {
  const [gameId, flag] = process.argv.slice(2);
  if (gameId === undefined) throw new Error("Usage: migrate-save-v34.mts <gameId> [--apply]");
  const url = process.env.DATABASE_URL?.trim();
  if (url === undefined || url.length === 0) throw new Error("DATABASE_URL is unavailable.");
  const database = createDatabase(url);
  try {
    const view = await getWorldView(database.db, gameId);
    if (view === undefined) throw new Error(`No world for game ${gameId}.`);
    const before: WorldState = view.world;

    const seated = seatFoundingPeopleInto(before, punicWarsFounding.writtenOut, punicWarsFounding.formOf);
    let world = seated.world as WorldState;
    // The Senate's named men, where the save does not have them yet.
    const senate = romanSenators(world.material.officeSeats.filter((seat) => seat.officeId === "roman-senator").length);
    const absent = (senate.characters as readonly { id: string }[]).filter((senator) => !world.characters.some((character) => character.id === senator.id));
    const absentIds = new Set(absent.map((senator) => senator.id));
    if (absent.length > 0) {
      const seats = (senate.officeSeats as readonly { holderCharacterId: string }[]).filter((seat) => absentIds.has(seat.holderCharacterId));
      const accounts = (senate.accounts as readonly { owner: { id: string } }[]).filter((account) => absentIds.has(account.owner.id));
      world = WorldStateSchema.parse({
        ...world,
        characters: [...world.characters, ...absent],
        material: { ...world.material, accounts: [...world.material.accounts, ...accounts], officeSeats: [...world.material.officeSeats, ...seats] },
      });
    }
    // Ground already lost in war before provinces remembered who lost them: a
    // power whose capital another now holds lost that province.
    const capitals = new Map(world.map.polities.filter((polity) => polity.capitalSettlementId !== null).map((polity) => [polity.capitalSettlementId!, polity.id]));
    const remembered: string[] = [];
    world = { ...world, map: { ...world.map, provinces: world.map.provinces.map((province) => {
      if (province.lostBy != null) return province;
      // The capital city itself in other hands -- not merely the country round it.
      const city = province.settlements.find((candidate) => capitals.has(candidate.id) && candidate.controllerPolityId !== capitals.get(candidate.id));
      const owner = city === undefined ? undefined : capitals.get(city.id);
      if (owner === undefined || province.controllerPolityId === null || province.controllerPolityId === owner) return province;
      remembered.push(`${province.name}: lost by ${owner}`);
      return { ...province, lostBy: { polityId: owner, atStep: world.elapsedStep } };
    }) } };
    // Finer skills for everybody who has none written (`withFinerSkills`).
    const skilled = world.characters.filter((character) => Object.keys(character.skills.subSkills ?? {}).length === 0).length;
    world = { ...world, characters: world.characters.map((character) => (Object.keys(character.skills.subSkills ?? {}).length === 0 ? withFinerSkills(character) : character)) };
    // The Mamertines' leader, by name.
    world = { ...world, characters: world.characters.map((character) => (character.id === "mamertine-spokesman" && character.name === "Mamertine spokesman" ? { ...character, name: "Statius Mettius" } : character)) };
    // Letters addressed to a stand-in of a real king go to the king.
    const standIns = new Map(world.characters
      .filter((character) => character.id.startsWith("npc:discovered:"))
      .flatMap((character) => {
        const real = world.characters.find((candidate) => candidate.id !== character.id && !candidate.id.startsWith("npc:discovered:") && spelledAlike(candidate.name, character.name));
        return real === undefined ? [] : [[character.id, real.id] as const];
      }));
    const repointed = world.diplomacy.filter((message) => message.toCharacterId !== null && standIns.has(message.toCharacterId)).length;
    world = { ...world, diplomacy: world.diplomacy.map((message) => (message.toCharacterId !== null && standIns.has(message.toCharacterId) ? { ...message, toCharacterId: standIns.get(message.toCharacterId)! } : message)) };

    const parsed = WorldStateSchema.parse(world);
    const introduced = findWorldReferenceViolations(parsed).length - findWorldReferenceViolations(before).length;
    console.log(JSON.stringify({ ...seated.report, senatorsAdded: absent.map((senator) => senator.id), groundRemembered: remembered, finerSkillsGiven: skilled, standIns: [...standIns], lettersRepointed: repointed, referenceViolationsIntroduced: introduced }, null, 2));
    if (introduced > 0) throw new Error("The migrated world would carry new dangling references; nothing written.");
    if (flag !== "--apply") {
      console.log("Dry run: nothing written. Pass --apply to write it.");
      return;
    }
    const backup = `${process.env.BACKUP_DIR ?? "."}/world-backup-${gameId}-${Date.now()}.json`;
    writeFileSync(backup, JSON.stringify(before));
    console.log(`Backup of the world as it was: ${backup}`);
    // Over the revision this repair read, and never while a burst is running.
    await persistRepairedWorld(database.db, { gameId, expectedRevision: view.revision, world: parsed });
    console.log("Written.");
  } finally {
    await database.close();
  }
}

void main();

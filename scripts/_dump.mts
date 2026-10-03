import { punicWarsScenario } from "/Users/andreidodu/Chronica/packages/db/src/punic-wars-scenario";
import { ensureConstitutions } from "/Users/andreidodu/Chronica/packages/sim/src/constitutions";
import { allOffices } from "@chronica/shared";
const { definition, initialWorld } = punicWarsScenario as any;
const world = ensureConstitutions({ world: initialWorld, government: definition.government, toDay: 0 });
const offices = allOffices(world, definition.government.offices);
const major = process.argv.slice(2);
const names = new Map(world.characters.map((c: any) => [c.id, c.name]));
for (const p of major) {
  console.log("==", p);
  for (const o of offices.filter((o: any) => o.polityId === p)) {
    const seats = world.material.officeSeats.filter((s: any) => s.officeId === o.id && s.status === "held" && s.holderCharacterId);
    console.log(`${o.id} [${o.kind ?? "magistracy"}] seats=${o.seatCount ?? 1} named=${seats.length} ${seats.map((s: any) => names.get(s.holderCharacterId)).join("; ")}`);
  }
}
console.log("total offices", offices.length, "empty", offices.filter((o: any) => !world.material.officeSeats.some((s: any) => s.officeId === o.id && s.holderCharacterId)).length);

import { PUNIC_IDS, punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";

export const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

/** The opening, with the campaign's people in it. The consul is the scenario's own. */
export function opening(): WorldState {
  const base = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const template = base.characters.find((character) => character.id === "quintus-ogulnius")!;
  const purse = base.material.accounts.find((account) => account.owner.kind === "character")!;
  const legion = base.material.forces.find((force) => force.id === "roman-field-army")!;
  const people: [string, string, string, number][] = [
    ["gaius-furius", "Gaius Furius", PUNIC_IDS.rhine, 800],
    ["marcus-metellus", "Marcus Caecilius Metellus", PUNIC_IDS.rome, 3_000],
    ["quintus-agrippinus", "Quintus Valerius Agrippinus", PUNIC_IDS.bovianum, 1_500],
  ];
  return {
    ...base,
    characters: [
      ...base.characters,
      ...people.map(([id, name, where]) => ({ ...structuredClone(template), id, name, locationProvinceId: where, officeId: null, personalAccountId: `${id}-purse` })),
    ],
    material: {
      ...base.material,
      accounts: [
        ...base.material.accounts,
        ...people.map(([id, , , balance]) => ({ ...structuredClone(purse), id: `${id}-purse`, owner: { kind: "character" as const, id }, balance })),
      ],
      forces: [...base.material.forces, {
        ...structuredClone(legion), id: "silver-shields", name: "Scuta Argentea",
        commanderCharacterId: "quintus-agrippinus", controllerCharacterId: "quintus-agrippinus",
        locationId: PUNIC_IDS.bovianum, positionId: null, authorizedStrength: 100, payObligationId: null,
        personnel: [{ ...structuredClone(legion.personnel[0]!), categoryId: "cavalry", label: "Horse", fit: 97 }],
      }],
    },
  };
}

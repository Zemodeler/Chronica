import { currentAgeYears } from "./age";
import { allOffices, type Office } from "./character";
import type { WorldState } from "../world/world-state";

/**
 * The mirror among your peers: Compared with you, turned round.
 *
 * A man's peers are those who hold or have held what he holds or held: the
 * sitting consuls and the men who were consuls before them. Against them he
 * is placed in words, "better known than most of them", on what is public
 * about a man: his renown, the offices he has held, the clients who follow
 * him, and his age. What is in their purses is theirs, and is not read.
 */

export interface PeerLine {
  readonly aspect: string;
  readonly label: string;
}

export interface PeersReading {
  /** "Among the consuls, sitting and former". */
  readonly among: string;
  readonly count: number;
  readonly lines: readonly PeerLine[];
}

function placeInWords(share: number, more: string, less: string): string {
  if (share >= 0.8) return `${more} almost all of them`;
  if (share >= 0.6) return `${more} most of them`;
  if (share > 0.4) return "about in the middle of them";
  if (share > 0.2) return `${less} most of them`;
  return `${less} almost all of them`;
}

/** The share of peers the viewer stands above on this measure; ties count half. */
function share(yours: number, theirs: readonly number[]): number {
  if (theirs.length === 0) return 0.5;
  const above = theirs.reduce((sum, value) => sum + (yours > value ? 1 : yours === value ? 0.5 : 0), 0);
  return above / theirs.length;
}

export function peersOf(world: WorldState, characterId: string, scenarioOffices: readonly Office[] = []): PeersReading | null {
  const viewer = world.characters.find((character) => character.id === characterId);
  if (viewer === undefined) return null;
  const offices = new Map(allOffices(world, scenarioOffices).map((office) => [office.id, office]));

  // The office that says most about him: one he sits in now, else the one he
  // held last. A magistracy outranks a seat in a council.
  const sitting = world.material.officeSeats.filter((seat) => seat.status === "held" && seat.holderCharacterId === characterId).map((seat) => seat.officeId);
  const former = [...viewer.officesHeld].sort((a, b) => b.lastHeldAtStep - a.lastHeldAtStep).map((held) => held.officeId);
  const candidates = [...new Set([...sitting, ...former])].map((id) => offices.get(id)).filter((office): office is Office => office !== undefined);
  const office = candidates.sort((a, b) => Number(b.kind === "magistracy") - Number(a.kind === "magistracy") || (b.rank ?? 0) - (a.rank ?? 0))[0];
  if (office === undefined) return null;

  const holdsIt = (id: string): boolean =>
    world.material.officeSeats.some((seat) => seat.status === "held" && seat.officeId === office.id && seat.holderCharacterId === id)
    || (world.characters.find((character) => character.id === id)?.officesHeld.some((held) => held.officeId === office.id) ?? false);
  const peers = world.characters.filter((character) => character.alive && character.id !== characterId && holdsIt(character.id));
  if (peers.length === 0) return null;

  const clients = (id: string): number => world.material.politicalGroups
    .filter((group) => group.active && group.type === "clientele" && group.leaderCharacterId === id)
    .reduce((sum, group) => sum + (group.strengthBps ?? 1_000), 0);
  const officesHeld = (id: string): number => {
    const character = world.characters.find((candidate) => candidate.id === id);
    const ids = new Set(character?.officesHeld.map((held) => held.officeId) ?? []);
    for (const seat of world.material.officeSeats) if (seat.status === "held" && seat.holderCharacterId === id) ids.add(seat.officeId);
    return ids.size;
  };

  const lines: PeerLine[] = [
    { aspect: "Renown", label: placeInWords(share(viewer.prestigeBps, peers.map((peer) => peer.prestigeBps)), "better known than", "less known than") },
    { aspect: "Offices", label: placeInWords(share(officesHeld(characterId), peers.map((peer) => officesHeld(peer.id))), "more offices held than", "fewer offices held than") },
  ];
  const clientCounts = peers.map((peer) => clients(peer.id));
  if (clients(characterId) > 0 || clientCounts.some((count) => count > 0)) {
    lines.push({ aspect: "Clients", label: placeInWords(share(clients(characterId), clientCounts), "more clients than", "fewer clients than") });
  }
  const age = (character: typeof viewer): number => currentAgeYears(character, world.elapsedStep);
  lines.push({ aspect: "Age", label: placeInWords(share(age(viewer), peers.map(age)), "older than", "younger than") });

  const plural = office.label.endsWith("s") ? office.label : `${office.label}s`;
  return { among: `Among the ${plural}, sitting and former`, count: peers.length, lines };
}

/**
 * Orders real players wrote, kept verbatim, to be put to a real model.
 *
 * The first four chains are a Discord campaign's orders exactly as sent,
 * minus the chat around them. The rest are the kinds of order a design
 * document never anticipates -- found a faith, build a school -- that the
 * engine has to answer without a rule written for each. The trade and
 * private-life chains are a private person's business -- a stall, a ship, a
 * loan, a tutor -- which no chain above asked of the engine at all, and which
 * is where it refused plain orders for want of a detail. An order in a chain
 * is given to the world the previous one left, by the same person.
 */
export interface CorpusOrder {
  readonly id: string;
  /** Orders sharing a chain run in sequence against one evolving world. */
  readonly chain: string;
  readonly actor: "gaius-furius" | "marcus-metellus" | "quintus-agrippinus" | "gaius-genucius" | "leptines-syracuse";
  readonly text: string;
}

export const CORPUS: readonly CorpusOrder[] = [
  {
    id: "gaius-1-rally", chain: "gaius", actor: "gaius-furius",
    text: "Gaius Furius, a Respected Legionary serving under the gaulic armys, would begin to rally the Gauls under his banner, promising them a unified gaulia under him, as he promises them to award them with roman citizenship and latinization, to be held equal to Romans, as he would begin the rallying in near the Rhine river.",
  },
  {
    id: "gaius-2-illyria", chain: "gaius", actor: "gaius-furius",
    text: "Gaius Furius, now with his army of gaul, would hopefully begin a march down towards The Antigonid macedonians through Illyria, he would propose to the illyrians to offer him military access with Gaius Furius paying gold for this to be considered.",
  },
  {
    id: "gaius-3-epirus", chain: "gaius", actor: "gaius-furius",
    text: "Gaius furius, now on the border of epirus would march in, utilizing his gauls to scout out the terrain during this process, as his roman legionarys would seek out to meet the Macedonian army at the Aoss River in Epirus, as gaius would organize his armys in this manner, he would have his roman maniples in the center to disrupt the 21ft sarissas of the macedonian phalanx, as his gauls would hide in nearby terrains to begin a flank on all sides when the signal would be fired. Gaius Furius would position his roman Triarri and Principes in the center, as the javelin throwers would be positioned on the flanks.",
  },
  {
    id: "gaius-4-hammer", chain: "gaius", actor: "gaius-furius",
    text: "To Counter Gonatas's Phalanx, Gaius would order his army to draw them onto rough, hilly ground previously scouted to fracture their rigid formation, and then he would order his highly flexible maniples to dive directly into the opening gaps, bypassing their 21-foot sarissas to attack the phalangites at close range with our gladii and gaulic weaponry, Gaius leading his hidden infantry in the nearby hidden valleys, would hammer into the Phalangite armys, forcing them between a hammer and anvil as Gaius hopes to encircle them from all sides.",
  },
  {
    id: "marcus-1-egypt", chain: "marcus", actor: "marcus-metellus",
    text: "Marcus caecilus metellus, was a pretty nice guy, he often went to the plebs in rome and they liked him hella, some called him the next Plebeian hero to save them from the Incestious Alien that governs rome, well, Marcus caecilus metellus would travel to egypt, seeking to get an egyptian wife.",
  },
  {
    id: "quintus-1-raid", chain: "quintus", actor: "quintus-agrippinus",
    text: "Quintus, now irresistibly annoyed and driven to the point of nausea due to lack of battle, would command his now 100 silver shields to begin an incursion into samnite territorys, raiding and pillaging towns at a fervent pace, as he sends the pillaged loot back to rome, quintus, ever so daring, would march down towards the lucanians if all went right and do the same.",
  },
  {
    id: "quintus-2-tribune", chain: "quintus", actor: "quintus-agrippinus",
    text: "Quintus, now reorganizing with the ala, would begin running for tribune, proposing to the senate to enact him as a tribune in the samnites war, he would utillize his influence with the silver shields and the equites to further push his campaign.",
  },
  {
    id: "quintus-3-ambush", chain: "quintus", actor: "quintus-agrippinus",
    text: "Quintus would remain cautious, ordering some of his silver shields to scout the terrain in advance of where the samnites retreated to, hiring local herders and farmers for maps and information about the terrain, as he orders his small detachment, alongside himself to lay in wait for an incoming samnite army near the high top hills of the pass.",
  },
  { id: "consul-church", chain: "church", actor: "gaius-genucius", text: "Start a church." },
  { id: "consul-academy", chain: "academy", actor: "gaius-genucius", text: "Build an academy." },
  { id: "consul-aqueduct", chain: "aqueduct", actor: "gaius-genucius", text: "Build an aqueduct for Rome and pay for its upkeep from the treasury." },
  { id: "consul-cult", chain: "cult", actor: "gaius-genucius", text: "Suppress the Bacchic cult in Campania and seize its temples." },
  { id: "trade-rome-1-cutlery", chain: "trade-rome", actor: "marcus-metellus", text: "I make a business deal and start selling cutlery in the streets of Rome." },
  { id: "trade-rome-2-stall", chain: "trade-rome", actor: "marcus-metellus", text: "The cutlery sells well. I hire two apprentices and open a second stall near the Forum." },
  { id: "trade-rome-3-loan", chain: "trade-rome", actor: "marcus-metellus", text: "I lend 300 drachmae to a shipowner at Ostia against his next cargo of grain." },
  { id: "trade-syracuse-1-oil", chain: "trade-syracuse", actor: "leptines-syracuse", text: "I fit out a ship and trade olive oil to Messana." },
  { id: "trade-syracuse-2-guild", chain: "trade-syracuse", actor: "leptines-syracuse", text: "I found a guild of Syracusan cutlers and pay for its hall out of my own purse." },
  { id: "private-1-greek", chain: "private-life", actor: "marcus-metellus", text: "I spend the season learning Greek from a tutor and reading Homer." },
  { id: "private-2-vineyard", chain: "private-life", actor: "marcus-metellus", text: "I buy a small vineyard outside Rome and hire a vilicus to run it." },
  // Orders nobody designed for (plan §2): each sets something going that no op
  // fits, and each has a reason to fire and a reason to stop.
  { id: "toll-1-bridge", chain: "toll", actor: "marcus-metellus", text: "I build a toll-house on the bridge into Rome and charge every cart that crosses." },
  { id: "toll-2-aediles", chain: "toll", actor: "marcus-metellus", text: "The aediles order my toll-house closed. I pay them off and keep it running quietly." },
  { id: "dole-1-grain", chain: "dole", actor: "marcus-metellus", text: "I buy grain with my own money and give it out to the poor of Rome every month." },
  { id: "school-1-open", chain: "school", actor: "leptines-syracuse", text: "I open a school in Syracuse and take pupils for a fee." },
  { id: "school-2-rival", chain: "school", actor: "leptines-syracuse", text: "A rival opens a school across the street. I lower my fees and hire a second teacher." },
  { id: "racket-1-forum", chain: "racket", actor: "marcus-metellus", text: "I hire toughs and make the shopkeepers of the Forum pay me for protection each month." },
  { id: "tithe-1-cult", chain: "tithe", actor: "quintus-agrippinus", text: "I found a cult of Bacchus in Campania and have its followers tithe to me." },
];

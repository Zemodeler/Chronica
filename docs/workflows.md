# Chronica workflow reference

> Generated from the workflow registry by `npm exec tsx scripts/generate-workflow-reference.ts`. Do not edit the per-workflow entries by hand.

## What a workflow is

A workflow is an MCP-style tool the AI uses to interact with Chronica's world data. It is not a story script or a fixed player verb. A workflow exposes a data capability and its input contract; the AI decides whether calling it is useful in the current situation. The workflow then performs a validated change or calculation.

Built-in workflows cover common world interactions. If none fits, the AI can use `define_action` to create a named, reusable campaign-local workflow. A defined workflow is a parameterised set of data operations and is checked before use: its parameters must be valid, the actor must be living, protected world fields cannot be changed, and the complete resulting world must pass schema and reference-integrity validation. It is then stored for later turns in that campaign and each use is audited.

`request_capability` remains for a need that cannot honestly be expressed as a world-data interaction; it records that need without changing the world.

## Built-in workflows

There are 97 built-in workflows in this reference. Every AI-callable workflow also receives an `actorId` identifying the living character making the interaction; that envelope field is not repeated below.

## Military workflows

### `army_change_name`

Rename an existing military force, such as an army or legion.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `forceId` (string, required)
- `newName` (string, required)

### `assign_command`

Assign a character as a force's commander through an authorized command_assignment procedure.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `forceId` (string, required)
- `commanderCharacterId` (string, required)
- `authorization` (object, optional)

### `blockade_port`

Place a naval blockade on a port settlement, recorded as a siege with no defending force.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `settlementId` (string, required)
- `blockadingForceIds` (array, required)

### `create_force`

Raise a new military force for a polity at a specified province. Use when a player orders raising an army, recruiting troops, or mustering soldiers. Requires a polity account to fund the obligation.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: 3–21 days (usually 7)

Parameters:

- `polityId` (string, required)
- `locationProvinceId` (string, required)
- `name` (string, required)
- `size` (integer, required)
- `kind` (infantry | cavalry | siege | naval | militia | mercenary | other, required)
- `payerAccountId` (string, optional)
- `intent` (string, optional)

### `disband_force`

Remove a military force from the world permanently.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `forceId` (string, required)
- `reason` (string, required)

### `disband_forces_bulk`

Disband multiple military forces at once (e.g. post-war demobilization).

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `forceIds` (array, required)
- `reason` (string, required)

### `end_battle`

Remove a battle from the active conflicts list.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: 1–1 days (usually 1)

Parameters:

- `battleId` (string, required)
- `outcomeLabel` (string, required)

### `end_siege`

End an active siege, optionally transferring province control.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: 1–1 days (usually 1)

Parameters:

- `settlementId` (string, required)
- `successfulCapture` (boolean, required)
- `newControllerPolityId` (string, optional)

### `injure_force`

Inflict casualties on a force, reducing its fit personnel count in a given category.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `forceId` (string, required)
- `categoryId` (string, required)
- `casualties` (integer, required)
- `causeId` (string, required)

### `lower_morale`

Decrease a force's morale by a given basis-points amount (floor at 0).

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: 1–7 days (usually 2)

Parameters:

- `forceId` (string, required)
- `deltaBps` (integer, required)

### `merge_forces`

Merge one force into another, combining personnel. The source force is removed.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `sourceForceId` (string, required)
- `targetForceId` (string, required)

### `move_force`

Move a military force to a different province, or to a named operational position within its current province. The force's locationId and, when specified, positionId change immediately.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: 3–45 days (usually 14)

Parameters:

- `forceId` (string, required)
- `destinationProvinceId` (string, required)
- `destinationPositionId` (string, optional)

### `raise_morale`

Increase a force's morale by a given basis-points amount (capped at 10 000).

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: 1–7 days (usually 2)

Parameters:

- `forceId` (string, required)
- `deltaBps` (integer, required)

### `resolve_battle`

Deterministically resolve an active battle from authoritative force, commander, terrain, position, and supply state. System-invoked only, immediately after start_battle.

- Category: military
- Available to: system
- Kind: system data operation
- Duration: uses the registry default estimate

Parameters:

- `battleId` (string, required)
- `attackerPosture` (offer_battle | avoid_battle | defend | hold, optional)
- `defenderPosture` (offer_battle | avoid_battle | defend | hold, optional)
- `tacticalProposals` (array, optional)

### `retreat_force`

Force a military force to retreat to an adjacent province.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `forceId` (string, required)
- `retreatToProvinceId` (string, required)

### `start_battle`

Start a battle between two sides, each one or more forces. A multi-force side is merged into the resolver as one combined contribution (docs/19 Phase 3); no new phase-arrival model is needed. An optional posture per side (offer_battle, avoid_battle, defend, hold) is carried through to the battle's deterministic resolution.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: 1–30 days (usually 14)

Parameters:

- `battleId` (string, required)
- `attackingForceIds` (array, required)
- `defendingForceIds` (array, required)
- `attackerPosture` (offer_battle | avoid_battle | defend | hold, optional)
- `defenderPosture` (offer_battle | avoid_battle | defend | hold, optional)

### `start_siege`

Begin a siege of a settlement by besieging forces.

- Category: military
- Available to: any AI principal
- Kind: AI data interaction
- Duration: 7–120 days (usually 30)

Parameters:

- `settlementId` (string, required)
- `invadingForceIds` (array, required)
- `defendingForceIds` (array, optional)

## Political workflows

### `answer_diplomatic_message`

The receiving power answers a standing diplomatic message: accepted, refused, countered, or deliberately left unanswered, in its own words. Acceptance records agreement only — carry out what was agreed with the workflow that models it (sign_treaty, end_war, impose_tribute, arrange_marriage_alliance).

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: 1–14 days (usually 3)

Parameters:

- `messageId` (string, required)
- `answer` (accepted | refused | countered | ignored, required)
- `answeredByCharacterId` (string, required)
- `answerText` (string, required)

### `arrange_marriage_alliance`

Record a dynastic marriage between two characters of different polities as a diplomatic alliance.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterAId` (string, required)
- `characterBId` (string, required)
- `relationId` (string, required)
- `sourceNote` (string, required)

### `break_alliance`

Dissolve an alliance between two polities.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `polityAId` (string, required)
- `polityBId` (string, required)
- `reason` (string, required)

### `call_vote`

The sponsor calls the eligible vote or decision, advancing a procedure to voting_or_deciding.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `procedureId` (string, required)
- `callerCharacterId` (string, required)

### `challenge_legitimacy`

Publicly challenge an institution's or polity's legitimacy through an authorized procedure.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `institutionId` (value, optional)
- `polityId` (value, optional)
- `challengerCharacterId` (string, required)
- `magnitudeBps` (integer, optional)
- `reason` (string, required)
- `authorization` (object, optional)

### `declare_independence`

Create a new polity that breaks away from a parent polity and claims a province.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `newPolityId` (string, required)
- `newPolityName` (string, required)
- `capitalSettlementId` (value, required)
- `claimedProvinceIds` (array, required)

### `end_war`

End an active war between two polities via treaty or defeat. System-invoked only: peace requires a passed political procedure (e.g. a treaty_ratification) naming this as its linked workflow, never a direct player/AI proposal.

- Category: political
- Available to: system
- Kind: system data operation
- Duration: uses the registry default estimate

Parameters:

- `polityAId` (string, required)
- `polityBId` (string, required)
- `termsLabel` (string, required)

### `give_territory`

Transfer control of a province from one polity to another by diplomatic cession -- an accepted diplomatic message between exactly the two powers involved is required as authorization. There is no other path through this workflow: an unopposed occupation or a won siege/battle goes through change_province_control instead.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `newControllerPolityId` (string, required)
- `firmnessBps` (integer, optional)
- `authorizingMessageId` (string, required)

### `impose_tribute`

Create a periodic tribute obligation from one polity's treasury to another.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `tributeId` (string, required)
- `payerAccountId` (string, required)
- `amount` (integer, required)
- `cadenceSteps` (integer, required)
- `label` (string, required)
- `atStep` (integer, required)

### `nominate_candidate`

Name a candidate for a proposed nomination or appointment procedure, subject to its eligibility requirements.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `procedureId` (string, required)
- `candidateCharacterId` (string, required)
- `nominatorCharacterId` (string, required)

### `pledge_support`

Record a character's or group's canonical support position on an open procedure, with the stated reason for it. Use inspect_political_procedure first: it surfaces each participant's relationship/legitimacy context as a suggestion, never a decision -- the position and reason here are yours to choose.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `procedureId` (string, required)
- `supporterKind` (character | group, required)
- `supporterId` (string, required)
- `position` (support | oppose | abstain | undecided, required)
- `reasonKind` (belief | relationship | commitment | threat | favour | ideology | group_loyalty | material_interest, required)
- `reasonLabel` (string, required)

### `public_denunciation`

Publicly denounce a character through an authorized procedure, costing them prestige.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `denouncerCharacterId` (string, required)
- `targetCharacterId` (string, required)
- `prestigeLossBps` (integer, optional)
- `reason` (string, required)
- `authorization` (object, optional)

### `rename_polity`

Change a polity's name (e.g. a country renaming itself after a regime change).

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `polityId` (string, required)
- `newName` (string, required)

### `resolve_procedure`

Decide an open political procedure that is ready: at voting_or_deciding, or past its deadline. Tallies the support positions already recorded (by the institution's own quorum/threshold rules, or the sponsor's authority) into a pass/fail outcome -- it invents no one's position, it only computes what the recorded positions already decide. If it passes, call the procedure's own linkedWorkflowId yourself (see inspect_political_procedure or list_due_political_procedures) with { authorization: { procedureId } } to carry out its effect: this tool only decides the vote, it does not itself grant an office, remove a rival, or otherwise act.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `procedureId` (string, required)

### `revoke_vassalage`

End a vassal's tribute obligation, restoring full independence.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `tributeObligationId` (string, required)
- `reason` (string, required)

### `send_diplomatic_message`

Send a letter, offer, request, demand, protest, or ultimatum from one power to another. Records the approach and obliges the receiving power to answer; it decides nothing on their behalf.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: 1–14 days (usually 3)

Parameters:

- `messageId` (string, required)
- `kind` (letter | alliance_offer | peace_offer | trade_offer | marriage_offer | military_aid_request | tribute_demand | ultimatum | warning | protest | congratulation, required)
- `fromPolityId` (string, required)
- `fromCharacterId` (string, required)
- `toPolityId` (string, required)
- `toCharacterId` (value, optional)
- `subject` (string, required)
- `terms` (string, required)
- `replyDueByStep` (value, optional)
- `inReplyToMessageId` (value, optional)
- `visibility` (public | polity | private, optional)

### `sign_treaty`

Record a peace treaty between two polities (ends war if active).

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `polityAId` (string, required)
- `polityBId` (string, required)
- `termsLabel` (string, required)

### `sponsor_procedure`

Open a new political procedure: a sponsor names its type, target, and resolution mechanism.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `procedureId` (string, required)
- `type` (nomination | appointment | removal | vote | council_deliberation | decree | petition | treaty_ratification | command_assignment | endorsement | denunciation | opposition_motion, required)
- `institutionId` (value, required)
- `sponsorCharacterId` (string, required)
- `subjectKind` (office_seat | character | force | treaty | polity | group, required)
- `subjectId` (value, required)
- `linkedWorkflowId` (string, required)
- `linkedWorkflowParams` (object, optional)
- `eligibilityRequirementIds` (array, optional)
- `eligibleParticipantIds` (array, optional)
- `resolutionMechanism` (vote | appointment_authority | seniority | decree_authority | sponsor_discretion, required)
- `visibility` (public | polity | private, required)
- `deadlineStep` (value, optional)
- `sourceEventIds` (array, optional)

### `start_war`

Declare war between two polities. Creates a war entry in conflicts.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `polityAId` (string, required)
- `polityBId` (string, required)

### `vassalize_polity`

Make one polity a tributary vassal of another by creating a recurring tribute obligation.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `overlordPolityId` (string, required)
- `vassalPolityId` (string, required)
- `vassalPayerAccountId` (string, required)
- `tributeObligationId` (string, required)
- `tributeAmount` (integer, required)
- `cadenceSteps` (integer, required)
- `atStep` (integer, required)

### `withdraw_diplomatic_message`

The sender withdraws a message that has not yet been answered, so it no longer stands between the two powers.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: 1–3 days (usually 1)

Parameters:

- `messageId` (string, required)
- `withdrawnByCharacterId` (string, required)
- `reason` (string, required)

### `withdraw_support`

Withdraw a previously recorded support position before a procedure resolves.

- Category: political
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `procedureId` (string, required)
- `supporterKind` (character | group, required)
- `supporterId` (string, required)

## Economic workflows

### `add_gold`

Add money to a character or polity account (income, spoils, gift, etc.).

- Category: economic
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `accountId` (string, required)
- `amount` (integer, required)
- `reason` (string, required)

### `cancel_income_source`

Deactivate a recurring income source.

- Category: economic
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `incomeSourceId` (string, required)

### `create_income_source`

Create a new recurring income source for an account.

- Category: economic
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `incomeSourceId` (string, required)
- `label` (string, required)
- `kind` (land | office | trade | pension | tax, required)
- `beneficiaryAccountId` (string, required)
- `originKind` (holding | office | position | polity, required)
- `originId` (string, required)
- `amount` (integer, required)
- `cadenceSteps` (integer, required)

### `grant_holding`

Grant a character legal holder rights over a territory-linked holding tied to an income source.

- Category: economic
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `holdingId` (string, required)
- `title` (string, required)
- `territoryId` (string, required)
- `legalHolderCharacterId` (string, required)
- `incomeSourceId` (string, required)
- `successionRuleId` (string, required)
- `physicalControlBps` (integer, optional)

### `remove_gold`

Remove money from a character or polity account (loss, tax, purchase, etc.).

- Category: economic
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `accountId` (string, required)
- `amount` (integer, required)
- `reason` (string, required)

### `transfer_gold`

Transfer money from one account to another.

- Category: economic
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `sourceAccountId` (string, required)
- `destinationAccountId` (string, required)
- `amount` (integer, required)
- `reason` (string, required)

## Character workflows

### `add_age`

LEGACY/system-only: directly correct a character's frozen start age. Normal play never advances age this way -- age derives from the scenario clock (characters/age.ts currentAgeYears).

- Category: character
- Available to: system
- Kind: system data operation
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `years` (integer, required)

### `advance_character_plot`

Advance a plot to a new stage after a real development, updating momentum, obstacle, and next intended move.

- Category: character
- Available to: world_director
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `plotId` (string, required)
- `newStage` (forming | preparing | attempting | consequence | adapting | resolved, required)
- `momentum` (integer, optional)
- `obstacle` (value, optional)
- `nextMove` (value, optional)
- `note` (string, optional)

### `appoint_to_office`

Assign a character to a government office. Requires an already-resolved, passed appointment procedure (or system authority).

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `officeId` (string, required)
- `authorization` (object, optional)

### `assign_nemesis`

Assign a character as the player's Nemesis. Must emerge organically — only assign when the character has active opposition and significant recent Chronicle presence.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `reason` (string, required)

### `break_commitment`

Break a commitment outright, at a reputational cost -- creates a pressure on the character who breaks it. Only the character who made the commitment may break it.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `commitmentId` (string, required)
- `reason` (string, required)

### `capture_character`

Record a character as captured (alive but unable to act freely).

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `capturedByPolityId` (string, required)
- `reason` (string, required)

### `change_allegiance`

Switch a character's polity allegiance to a new polity.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `newPolityId` (string, required)
- `reason` (string, required)

### `clear_nemesis`

Deactivate a Nemesis (e.g., because they died or the conflict was resolved).

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `reason` (string, required)

### `create_character_goal`

Give a character a new persistent goal. Use when current world facts give them a concrete reason to pursue one.

- Category: character
- Available to: world_director
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `objective` (string, required)
- `category` (preserve_power | acquire_office | discredit_rival | alliance | revenge | resource | narrative, required)
- `targetEntityIds` (array, optional)
- `priority` (integer, required)
- `visibility` (public | polity | private, required)

### `create_character_plot`

Create a new plot for a character pursuing a goal. A plot is a concrete attempt with participants, objective, stakes, and a starting stage.

- Category: character
- Available to: world_director
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `goalId` (string, required)
- `objective` (string, required)
- `participantIds` (array, optional)
- `targetIds` (array, optional)
- `visibility` (public | polity | private, required)
- `stakes` (string, required)
- `currentObstacle` (value, optional)
- `worldStorylineId` (value, optional)

### `create_child_character`

Create a distinct newborn character with a validated mind and family links to its living parent(s). Never copies a parent's relations, beliefs, or mind.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `childCharacterId` (string, required)
- `name` (string, required)
- `parentCharacterIds` (array, required)
- `cultureId` (string, optional)

### `create_world_character`

Create a new named NPC in the world. World Director authority only. Requires a provenance record.

- Category: character
- Available to: world_director
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, optional)
- `name` (string, required)
- `polityId` (value, optional)
- `locationProvinceId` (string, required)
- `officeId` (value, optional)
- `provenance` (object, required)

### `defer_commitment`

Defer a commitment to a later review step, without penalty. Only the character who made the commitment may defer it.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `commitmentId` (string, required)
- `reason` (string, required)
- `reviewInSteps` (integer, optional)

### `dissolve_life_contract`

Dissolve, widow, or separate an active life contract, ending its paired family link.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `contractId` (string, required)
- `resolution` (dissolved | widowed | separated, required)
- `reason` (string, required)

### `fulfill_commitment`

Keep a commitment you made, spending the promised resource for real. Only the character who made the commitment may fulfill it.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `commitmentId` (string, required)

### `heal_character`

Restore a character's health basis-points (capped at 10 000).

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `healthGainBps` (integer, required)

### `incapacitate_character`

Mark a living character incapacitated -- alive but unable to hold office or act freely.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `cause` (string, required)

### `injure_character`

Reduce a character's health basis-points, reflecting wounds or illness.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `healthLossBps` (integer, required)
- `cause` (string, required)

### `investigate`

Look further into a suspicion you already hold, raising your own confidence in it by a fixed amount. Only the belief's own holder may investigate it.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `beliefId` (string, required)

### `kill_character`

Mark a character as dead and record the step of death.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `cause` (string, required)

### `materialize_declared_player`

Place a confirmed player declaration into the world with its character, purse, and any valid starting office.

- Category: character
- Available to: system
- Kind: system data operation
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `knowledgebase` (object, required)
- `scenarioGovernment` (object, optional)

### `move_character`

Relocate a character to a different province.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `destinationProvinceId` (string, required)

### `promote_character`

Increase a character's prestige basis-points.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `prestigeGainBps` (integer, required)
- `reason` (string, required)

### `propose_life_contract`

Form a marriage/partnership, guardianship, adoption/heir designation, or household membership between eligible parties.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `contractId` (string, required)
- `type` (marriage_or_partnership | guardianship | adoption_or_heir_designation | household_membership, required)
- `partyCharacterIds` (array, required)
- `institutionId` (value, optional)
- `eligibilityRequirementIds` (array, optional)
- `visibility` (public | polity | private, required)

### `record_character_social_action`

Record a pure social action toward another character -- a threat, an attempt at reconciliation, a favour, a negotiation, or public opposition. Moves the relationship by a fixed amount for the given kind; the target, kind, and stated reason are yours to choose.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `targetCharacterId` (string, required)
- `kind` (threaten | reconcile | offer_favour | negotiate | publicly_oppose | seek_support | request_assistance, required)
- `reasonLabel` (string, required)

### `recover_from_incapacity`

Clear a character's incapacitated status. Does not restore any office already refilled.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)

### `remove_from_office`

Remove a character from their current government office. Requires an already-resolved, passed removal procedure (or system authority).

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `reason` (string, required)
- `authorization` (object, optional)

### `rename_character`

Give a character their proper name. Use it on a leader the engine seeded for a power that had none (named '<Power> leader') as soon as you know who they are, so the record calls them by a name rather than a role.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `newName` (string, required)

### `renegotiate_commitment`

Propose new terms for a commitment you can no longer keep as originally made -- a different resource, office, or description. Only the character who made the commitment may renegotiate it; the beneficiary is informed, not asked to agree.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `commitmentId` (string, required)
- `description` (string, required)
- `requiredResource` (value, optional)
- `requiredOfficeId` (value, optional)
- `reviewInSteps` (integer, optional)

### `resolve_character_plot`

Mark a plot as succeeded, failed, abandoned, exposed, or stalled after its real outcome is known.

- Category: character
- Available to: world_director
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `plotId` (string, required)
- `status` (succeeded | failed | abandoned | exposed | stalled, required)
- `note` (string, required)

### `retire_character`

Mark a living character retired from active office-holding, vacating any office they hold.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `characterId` (string, required)
- `reason` (string, required)

### `settle_estate`

Settle a deceased character's estate: transfer assets to beneficiaries per their inheritance rule, or escheat it if none applies. Call this once, promptly after a death.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `ownerCharacterId` (string, required)

### `spread_belief`

Share a claim you hold with another character, privately -- granting them a belief of their own through the same channel dialogue uses. The claim, its kind, and the recipient are yours to choose; how much they end up believing it is the channel's own, fixed rule.

- Category: character
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `targetCharacterId` (string, required)
- `subjectEntityId` (value, required)
- `claim` (string, required)
- `kind` (fact | rumour | suspicion | secret, required)
- `channel` (direct_witness | event_participant | public_announcement | trusted_report | ordinary_rumour | private_disclosure | intercepted_secret, optional)

### `update_character_goal`

Update the status or priority of an existing character goal after a real development.

- Category: character
- Available to: world_director
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `goalId` (string, required)
- `status` (active | achieved | abandoned | failed, optional)
- `priority` (integer, optional)
- `note` (string, optional)

## Narrative workflows

### `create_storyline`

Start a new narrative storyline in the world.

- Category: narrative
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `storylineId` (string, required)
- `title` (string, required)
- `participantIds` (array, required)
- `provinceId` (value, required)
- `phase` (string, required)
- `stakes` (string, required)
- `nextDevelopment` (string, required)
- `visibility` (public | polity | private, required)

### `resolve_storyline`

Conclude a storyline by recording its final outcome.

- Category: narrative
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `storylineId` (string, required)
- `resolution` (string, required)

### `update_storyline`

Advance an existing storyline to a new phase with updated stakes.

- Category: narrative
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `storylineId` (string, required)
- `phase` (string, required)
- `stakes` (string, required)
- `historyEntry` (string, required)
- `nextDevelopment` (string, required)

## Map workflows

### `cede_settlement`

Change a single settlement's local controller without changing the province's controller (a city defects or surrenders independently).

- Category: map
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `settlementId` (string, required)
- `newControllerPolityId` (value, required)

### `change_administration`

Record who actually administers a province day to day -- may lag behind its formal controller during a contested handover, and feeds tax-capacity calculations.

- Category: map
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `administeringPolityId` (string, required)
- `taxCapacityBps` (integer, optional)
- `reason` (string, required)

### `change_occupation`

Record which polity's forces physically occupy a province, independent of who legally controls it. Ending occupation (occupyingPolityId: null) simply withdraws without transferring control or touching any claim.

- Category: map
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `occupyingPolityId` (value, required)
- `forceId` (value, optional)
- `reason` (string, required)

### `change_province_control`

Transfer control of a province to a different polity, adjusting firmness. Does no verification of defenders or reachability -- it simply sets the new controller. A siege, battle, or diplomatic cession (give_territory) is how such a change would normally be earned; use this to record the resulting fact.

- Category: map
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `newControllerPolityId` (value, required)
- `firmnessBps` (integer, optional)
- `reason` (string, required)

### `change_province_tier`

Change a province's detail tier (focus, near, or far).

- Category: map
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `newTier` (focus | near | far, required)

### `fortify_province_capital`

Set the fortification level of a province's principal settlement directly (capital-defense projects, siege preparation).

- Category: map
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `settlementId` (string, required)
- `newFortificationLevel` (integer, required)

### `fortify_settlement`

Increase the fortification level of a settlement.

- Category: map
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `settlementId` (string, required)
- `levelIncrease` (integer, required)

### `found_settlement`

Found a new settlement inside an existing province. World Director authority only.

- Category: map
- Available to: world_director
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `settlementId` (string, required)
- `name` (string, required)
- `kind` (city | town | village | fortress | port, required)
- `size` (integer, required)
- `controllerPolityId` (value, optional)

### `merge_provinces`

Merge one province into another, moving all settlements and dropping the absorbed province.

- Category: map
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `absorbedProvinceId` (string, required)
- `targetProvinceId` (string, required)

### `raze_settlement`

Permanently remove a settlement from its province (destruction, depopulation).

- Category: map
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `settlementId` (string, required)
- `reason` (string, required)

### `rename_province`

Change the name of a province (adds the old name to formerNames).

- Category: map
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `newName` (string, required)

### `split_province`

Split a province in two, moving named settlements (by id) into a new province.

- Category: map
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `sourceProvinceId` (string, required)
- `newProvinceId` (string, required)
- `newProvinceName` (string, required)
- `terrainId` (string, required)
- `movedSettlementIds` (array, required)

### `weaken_province_control`

Reduce the control firmness of a province without changing its controller.

- Category: map
- Available to: any AI principal
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `lossBps` (integer, required)
- `reason` (string, required)

## Material workflows

### `collect_emergency_taxation`

Levy emergency taxation or requisition against a controlled province's tax capacity, depositing the collected amount into a treasury account. Yields less, and costs more stability, from an already unstable province.

- Category: material
- Available to: player, character_director
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `accountId` (string, required)
- `requestedAmount` (integer, required)
- `reason` (string, required)

### `recruit_from_province`

Recruit personnel into an existing force from a province's available manpower, paid from a treasury account. Requires the force's polity to control the province, enough available manpower, and enough funds.

- Category: material
- Available to: player, character_director
- Kind: AI data interaction
- Duration: uses the registry default estimate

Parameters:

- `provinceId` (string, required)
- `forceId` (string, required)
- `categoryId` (string, required)
- `recruitCount` (integer, required)
- `payerAccountId` (string, required)


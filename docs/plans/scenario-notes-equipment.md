# Scenario notes: equipment, crews, classes and refills

No scenario data changes, and no version of the Punic scenario is bumped for it (`built-in-versions.ts` and the pin are untouched).

- Two new optional fields on a force (`equipmentBps`, `equipmentReckonedToStep`, and `refilledAtStep`): absent in every authored world, set by the engine the first month an army on pay is looked at. An older save reads as an army at the ordinary condition and fights as it did.
- The kit tables (`KIT_BY_KIND`), the wear rates, the crews (300 to a warship, 40 to a transport) and the census share (`assiduiShareBps`) are engine constants (`packages/shared/src/warfare/equipment.ts`); a scenario shapes them only through what it already authors:
  `establishments[].equipment` (`"state"` doubles what the quartermaster may spend, as Carthage's does), `establishments[].recruitment` (`basis: "property_class"` and its `floor` turn the census classes on for a power: Rome; `"mercenary"` with `"self"` halves the renewal), the troop categories' ids (a category id naming horse, light troops, elephants, ships or transports is kitted as that kind), and the provinces' `developmentBps`.
- A scenario that wants a power to keep its own classes should author `recruitment.basis: "property_class"` for it; none other is changed here.
- If a later version should author its own kit (a nation whose men go in felt and leather), the place is a new db file read by the quartermaster, not the pin.

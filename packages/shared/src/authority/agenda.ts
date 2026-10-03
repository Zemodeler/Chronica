import type { Administration } from "./administration";
import type { CalendarItem } from "./calendar";
import type { LawsReading } from "./laws";
import type { MatterFocus, MatterPart, Matters } from "./matters";
import type { StandingOrders } from "./standing-orders";

/**
 * The agenda: what is open to the player, in three groups, each thing once.
 *
 * Matters in hand already drew together letters, votes, promises, works and
 * wars, and the calendar listed the dated ones beside them, so a letter
 * awaiting an answer, or a vote before the Senate, appeared in both and the
 * list was longer than the number of things in it. The agenda is those same
 * readings, and the newer ones (laws, standing orders, administration), put
 * under one key per thing -- the key the thing already has -- and sorted into
 * what wants the player's word, what is coming, and what is only going on.
 *
 * It computes nothing of its own about the world. Every item comes from a
 * reading that has already been gated for what the player may know, so the
 * agenda cannot say more than the sheets it points to.
 */

/** Where selecting an item takes the player. */
export type AgendaDestination =
  | { readonly surface: "people" }
  | { readonly surface: "self" }
  | { readonly surface: "council"; readonly key?: string }
  | { readonly surface: "standing"; readonly tab: "state" | "constitution" | "laws" | "treaties"; readonly key?: string }
  | { readonly surface: "books"; readonly tab: "administration"; readonly key?: string }
  | { readonly surface: "chronicle"; readonly focus: MatterFocus | null };

export type AgendaGroup = "attention" | "soon" | "ongoing";

export interface AgendaItem {
  /** One per thing: the key the thing has everywhere else. */
  readonly key: string;
  readonly group: AgendaGroup;
  /** What it is. */
  readonly title: readonly MatterPart[];
  /** When it matters: "in 12 days", "by 15 March". Null for what has no date. */
  readonly when: string | null;
  /** Where it stands, in a word or two: "Wants your word", "Stalled", "Under way". */
  readonly status: string;
  readonly marked: boolean;
  /** Shown only when the item is opened. */
  readonly context: readonly string[];
  readonly go: { readonly label: string; readonly to: AgendaDestination } | null;
  /** Days from today, for sorting; null when undated. */
  readonly inDays: number | null;
}

export interface Agenda {
  readonly groups: readonly { readonly group: AgendaGroup; readonly label: string; readonly items: readonly AgendaItem[] }[];
  /** How many items want the player's word. */
  readonly wanting: number;
}

const GROUP_LABEL: Readonly<Record<AgendaGroup, string>> = {
  attention: "Needs your attention",
  soon: "Coming soon",
  ongoing: "Ongoing",
};
const GROUP_ORDER: readonly AgendaGroup[] = ["attention", "soon", "ongoing"];
const RANK: Readonly<Record<AgendaGroup, number>> = { attention: 0, soon: 1, ongoing: 2 };

/** The key a thing is known by, whatever reading it came from. */
export function canonicalKey(key: string): string {
  // A calendar entry for a work's milestone is the work.
  const project = /^project:([^:]+):.+$/.exec(key);
  if (project !== null) return `project:${project[1]}`;
  // A march is its project: the calendar's "march Legio II" and the desk's
  // "Legio II marching" were listed twice, once as coming and once as ongoing.
  const march = /^march:([^:]+)$/.exec(key);
  if (march !== null) return `project:${march[1]}`;
  // A vote carried and not done is the measure.
  if (key.startsWith("carried:")) return `law:${key.slice("carried:".length)}`;
  return key;
}

export function destinationFor(key: string): { readonly label: string; readonly to: AgendaDestination } | null {
  const id = key.slice(key.indexOf(":") + 1);
  switch (key.split(":")[0]) {
    case "letter": return { label: "Open the letters", to: { surface: "people" } };
    case "procedure": return { label: "See the measure", to: { surface: "standing", tab: "laws", key: id } };
    case "law": return { label: "See the law", to: { surface: "standing", tab: "laws", key: id } };
    case "promise": return { label: "See the promise", to: { surface: "self" } };
    case "war":
    case "agreement": return { label: "See the treaties", to: { surface: "standing", tab: "treaties" } };
    case "seat": return { label: "See your office", to: { surface: "standing", tab: "state" } };
    case "contingency":
    case "stage": return { label: "See the standing order", to: { surface: "council", key } };
    case "dept": return { label: "See the department", to: { surface: "books", tab: "administration", key: id } };
    case "audit": return { label: "See the books", to: { surface: "books", tab: "administration" } };
    case "project":
    case "march":
    case "contract":
    case "plot":
    case "pursuit":
    case "order": return { label: "See the desk", to: { surface: "council", key } };
    default: return null;
  }
}

export interface AgendaInput {
  readonly calendar: readonly CalendarItem[];
  readonly matters: Matters;
  readonly laws: LawsReading;
  readonly orders: StandingOrders;
  readonly administration: Administration;
}

export function buildAgenda(input: AgendaInput): Agenda {
  const items = new Map<string, AgendaItem>();

  const put = (next: AgendaItem): void => {
    const known = items.get(next.key);
    if (known === undefined) { items.set(next.key, next); return; }
    // The same thing seen from two readings: keep the more pressing group,
    // the date wherever either has one, and every line of context once.
    const group = RANK[next.group] < RANK[known.group] ? next.group : known.group;
    const lead = group === next.group && next.group !== known.group ? next : known;
    const other = lead === next ? known : next;
    items.set(next.key, {
      ...lead,
      group,
      when: lead.when ?? other.when,
      inDays: lead.inDays ?? other.inDays,
      marked: lead.marked || other.marked,
      context: [...new Set([...lead.context, ...other.context])],
      go: lead.go ?? other.go,
    });
  };

  const beforeByKey = new Map(input.laws.before.map((row) => [row.key, row]));
  const inForceByKey = new Map(input.laws.inForce.map((row) => [row.key, row]));

  for (const entry of input.calendar) {
    const key = canonicalKey(entry.key);
    put({
      key,
      group: entry.needsYou ? "attention" : "soon",
      title: [entry.label],
      when: entry.whenLabel,
      status: entry.needsYou ? "Wants your word" : entry.inDays <= 1 ? "Imminent" : "Coming",
      marked: entry.needsYou,
      context: [],
      go: destinationFor(key),
      inDays: entry.inDays,
    });
  }

  for (const section of input.matters.sections) {
    for (const row of section.rows) {
      const key = canonicalKey(row.key);
      const group: AgendaGroup = section.section === "wants_your_word" ? "attention"
        : row.marked ? "attention"
          : "ongoing";
      const status = section.section === "wants_your_word" ? "Wants your word"
        : section.section === "voted_not_done" ? "Voted, not done"
          : section.section === "promised_to_you" ? "Promised to you"
            : section.section === "promised_by_you" ? "Promised by you"
              : section.section === "wars" ? "At war"
                : row.marked ? "Stalled" : "Under way";
      const law = beforeByKey.get(key) ?? inForceByKey.get(key.replace(/^procedure:/, ""));
      put({
        key,
        group,
        title: row.parts,
        when: null,
        status,
        marked: row.marked,
        context: [
          ...(row.detail === null ? [] : [row.detail]),
          ...(law === undefined ? [] : [law.sentence]),
        ],
        go: key.startsWith("procedure:") && law !== undefined ? { label: "See the measure", to: { surface: "standing", tab: "laws", key: law.key } }
          : destinationFor(key) ?? (row.focus === null ? null : { label: "In the Chronicle", to: { surface: "chronicle", focus: row.focus } }),
        inDays: null,
      });
    }
  }

  // Standing orders: a plan waiting is ongoing; one whose trigger was met and
  // which hands the player the wheel wants their word.
  for (const order of input.orders.rows) {
    if (order.status === "completed" || order.status === "cancelled") continue;
    put({
      key: order.key,
      group: order.status === "triggered" ? "attention" : "ongoing",
      title: [order.summary],
      when: null,
      status: order.status === "triggered" ? "Triggered" : "Waiting",
      marked: order.status === "triggered",
      context: [order.detail.statusNote],
      go: destinationFor(order.key),
      inDays: null,
    });
  }

  // Measures before the councils that the player is party to want a word;
  // the rest are only going on. Laws gone wrong want one too.
  for (const row of input.laws.before) {
    const key = `procedure:${row.key}`;
    put({
      key,
      group: row.marked ? "attention" : "ongoing",
      title: [row.name],
      when: null,
      status: row.marked ? "Wants your word" : "Before the councils",
      marked: row.marked,
      context: [row.sentence],
      go: { label: "See the measure", to: { surface: "standing", tab: "laws", key: row.key } },
      inDays: null,
    });
  }
  for (const row of input.laws.inForce) {
    if (!row.marked) continue;
    put({
      key: `law:${row.key}`,
      group: "attention",
      title: [row.name],
      when: null,
      status: "Gone wrong",
      marked: true,
      context: [row.detail.status],
      go: { label: "See the law", to: { surface: "standing", tab: "laws", key: row.key } },
      inDays: null,
    });
  }

  // Departments with a known issue.
  for (const department of input.administration.departments) {
    if (department.issue === null || !department.issue.marked) continue;
    put({
      key: `dept:${department.key}`,
      group: "attention",
      title: [`${department.name}: ${department.issue.text.replace(/\.$/, "").replace(/^./, (first) => first.toLowerCase())}`],
      when: null,
      status: "Known issue",
      marked: true,
      context: department.findings.map((finding) => finding.text),
      go: { label: "See the department", to: { surface: "books", tab: "administration", key: department.key } },
      inDays: null,
    });
  }

  const all = [...items.values()];
  const groups = GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABEL[group],
    items: all
      .filter((item) => item.group === group)
      .sort((a, b) => Number(b.marked) - Number(a.marked) || (a.inDays ?? Infinity) - (b.inDays ?? Infinity)),
  })).filter((entry) => entry.items.length > 0);
  return { groups, wanting: all.filter((item) => item.marked).length };
}

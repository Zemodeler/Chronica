"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

/**
 * A word you can ask about, and the note that answers, which has words of its
 * own you can ask about in turn.
 *
 * Crusader Kings' way with a dense screen: hover a marked word and a note
 * opens; hold still on it and the note pins, and only a pinned note can be
 * moved into, so the words inside it open notes of their own. Leave a pinned
 * note and it closes after a moment, taking the notes above it along. Escape
 * puts down the top one. A click pins at once, and from the keyboard, focus
 * opens a note and Enter pins it and moves into it.
 *
 * Notes live in a `TipRoot`, which every sheet has. They are popovers, so they
 * sit in the top layer above the sheet's own <dialog>, where overflow cannot
 * clip them, while staying inside it in the DOM, so the modal does not make
 * them inert. Outside a root a `Tip` is just its words.
 */

const OPEN_DELAY = 220;
const LOCK_DELAY = 900;
const GRACE = 280;

interface OpenTip {
  readonly id: string;
  readonly label: string;
  readonly anchor: HTMLElement;
  readonly render: () => ReactNode;
  readonly locked: boolean;
  /** Set beside the word rather than under it: a row in a list the note must not cover. */
  readonly beside?: boolean | undefined;
}

interface Layer {
  readonly stack: readonly OpenTip[];
  open(level: number, tip: Omit<OpenTip, "locked">, locked: boolean): void;
  closeFrom(level: number): void;
}

const LayerContext = createContext<Layer | null>(null);
/** How many notes deep this part of the page is: 0 on the sheet itself. */
const LevelContext = createContext(0);

const inside = (element: Element | null | undefined, x: number, y: number): boolean => {
  if (element == null) return false;
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

export function TipRoot({ children }: { readonly children: ReactNode }) {
  const [stack, setStack] = useState<readonly OpenTip[]>([]);
  const stackRef = useRef(stack);
  const elements = useRef(new Map<string, HTMLElement>());
  const lockTimers = useRef(new Map<string, number>());
  const grace = useRef<number | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const swallowCancel = useRef(false);
  /**
   * A note gone back to by its trail. The pointer was on the note above,
   * which is gone, so it is not over this one: it stays until the pointer
   * reaches it, and from then on keeps the usual rules.
   */
  const returnedTo = useRef<string | null>(null);
  const host = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => { stackRef.current = stack; }, [stack]);

  const closeFrom = useCallback((level: number) => {
    setStack((current) => (current.length > level ? current.slice(0, level) : current));
  }, []);

  const open = useCallback((level: number, tip: Omit<OpenTip, "locked">, locked: boolean) => {
    setStack((current) => {
      const there = current[level];
      if (there?.id === tip.id) return locked && !there.locked ? [...current.slice(0, level), { ...there, locked: true }, ...current.slice(level + 1)] : current;
      return [...current.slice(0, level), { ...tip, locked }];
    });
    window.clearTimeout(lockTimers.current.get(tip.id));
    if (!locked) {
      lockTimers.current.set(tip.id, window.setTimeout(() => {
        setStack((current) => current.map((candidate) => (candidate.id === tip.id ? { ...candidate, locked: true } : candidate)));
      }, LOCK_DELAY));
    }
  }, []);

  // Which notes the pointer is still with: every one up to the deepest whose
  // note (if pinned) or whose word it is over. An unpinned note beyond that
  // goes at once, since it could never be reached; a pinned one gets a moment,
  // so a hand that strays over the edge does not lose it.
  const keptCount = useCallback((x: number, y: number): number => {
    let deepest = -1;
    stackRef.current.forEach((tip, index) => {
      const over = tip.locked && inside(elements.current.get(tip.id), x, y);
      if (over && returnedTo.current === tip.id) returnedTo.current = null;
      if (inside(tip.anchor, x, y) || over || returnedTo.current === tip.id) deepest = index;
    });
    return deepest + 1;
  }, []);

  const active = stack.length > 0;
  useEffect(() => {
    if (!active) return;
    const onMove = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointer.current = { x: event.clientX, y: event.clientY };
      const keep = keptCount(event.clientX, event.clientY);
      const current = stackRef.current;
      if (keep >= current.length) {
        if (grace.current !== null) { window.clearTimeout(grace.current); grace.current = null; }
        return;
      }
      if (!current[keep]!.locked) { closeFrom(keep); return; }
      if (grace.current !== null) return;
      grace.current = window.setTimeout(() => {
        grace.current = null;
        const at = pointer.current;
        if (at !== null) closeFrom(keptCount(at.x, at.y));
      }, GRACE);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const current = stackRef.current;
      const top = current[current.length - 1];
      if (top === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      swallowCancel.current = true;
      window.setTimeout(() => { swallowCancel.current = false; }, 0);
      const focusWasInIt = elements.current.get(top.id)?.contains(document.activeElement) === true;
      closeFrom(current.length - 1);
      if (focusWasInIt || document.activeElement === top.anchor) top.anchor.focus({ preventScroll: true });
    };
    // A note is set against the words it explains; once the page under it
    // moves it would be explaining something else.
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && [...elements.current.values()].some((element) => element.contains(target))) return;
      closeFrom(0);
    };
    // Escape on a modal <dialog> asks it to close as well; the note was what
    // Escape was for.
    const dialog = host.current?.closest("dialog") ?? null;
    const onCancel = (event: Event) => { if (swallowCancel.current) event.preventDefault(); };
    document.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    dialog?.addEventListener("cancel", onCancel);
    return () => {
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      dialog?.removeEventListener("cancel", onCancel);
      if (grace.current !== null) { window.clearTimeout(grace.current); grace.current = null; }
    };
  }, [active, closeFrom, keptCount]);

  useEffect(() => () => { for (const timer of lockTimers.current.values()) window.clearTimeout(timer); }, []);

  const layer = useMemo<Layer>(() => ({ stack, open, closeFrom }), [stack, open, closeFrom]);
  const register = useCallback((id: string, element: HTMLElement | null) => {
    if (element === null) elements.current.delete(id);
    else elements.current.set(id, element);
  }, []);

  return (
    <LayerContext.Provider value={layer}>
      <LevelContext.Provider value={0}>{children}</LevelContext.Provider>
      <span ref={host} hidden />
      {stack.map((tip, index) => (
        <TipNote
          key={tip.id}
          tip={tip}
          level={index + 1}
          register={register}
          trail={stack.slice(0, index).map((below) => below.label)}
          onBack={(to) => { returnedTo.current = stack[to]?.id ?? null; closeFrom(to + 1); }}
        />
      ))}
    </LayerContext.Provider>
  );
}

function TipNote({ tip, level, register, trail, onBack }: {
  readonly tip: OpenTip;
  readonly level: number;
  readonly register: (id: string, element: HTMLElement | null) => void;
  /** The notes beneath this one, by name: "Dentatus › his patron". */
  readonly trail: readonly string[];
  /** Put down every note above the one at this depth. */
  readonly onBack: (depth: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    register(tip.id, element);
    try { element.showPopover(); } catch { /* already shown, or no popover support: it still renders in place */ }
    // Below the word, or above it where there is no room below; never off
    // the side of the window.
    const place = () => {
      const at = tip.anchor.getBoundingClientRect();
      const { offsetWidth: width, offsetHeight: height } = element;
      let top: number;
      let left: number;
      if (tip.beside === true && at.right + 8 + width <= window.innerWidth - 8) {
        left = at.right + 8;
        top = Math.max(8, Math.min(Math.max(8, at.top - 8), window.innerHeight - height - 8));
      } else {
        const below = at.bottom + 6;
        top = below + height > window.innerHeight - 8 ? Math.max(8, at.top - 6 - height) : below;
        left = Math.min(Math.max(8, at.left - 12), window.innerWidth - width - 8);
      }
      element.style.top = `${top}px`;
      element.style.left = `${left}px`;
    };
    place();
    // A record can expand within its note. Keep the expanded note on screen.
    const resize = new ResizeObserver(place);
    resize.observe(element);
    return () => {
      resize.disconnect();
      register(tip.id, null);
      try { element.hidePopover(); } catch { /* gone already */ }
    };
  }, [tip.id, tip.anchor, tip.beside, register]);

  return (
    <div
      ref={ref}
      id={tip.id}
      popover="manual"
      role="dialog"
      aria-label={tip.label}
      tabIndex={-1}
      className={tip.locked ? "tip is-locked" : "tip"}
    >
      {/* Deep in notes, a trail back: each step puts down the notes above it. */}
      {trail.length > 0 && (
        <nav className="tip__trail" aria-label="Back through the notes">
          {trail.map((label, depth) => (
            <span key={`${depth}-${label}`}>
              <button type="button" className="tip__crumb" onClick={(event) => { event.stopPropagation(); onBack(depth); }}>{label}</button>
              <span aria-hidden="true"> › </span>
            </span>
          ))}
          <span aria-current="true">{tip.label}</span>
        </nav>
      )}
      <LevelContext.Provider value={level}>{tip.render()}</LevelContext.Provider>
    </div>
  );
}

/**
 * A word with a note behind it. `note` is called when the note opens, so a
 * sheet full of them builds only the ones that are asked for.
 */
export function Tip({ note, label, children, className, beside }: {
  readonly note: () => ReactNode;
  /** What a screen reader calls the note. */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
  /** Open to the side of the word, where there is room, instead of below it. */
  readonly beside?: boolean;
}) {
  const layer = useContext(LayerContext);
  const level = useContext(LevelContext);
  const id = `tip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ref = useRef<HTMLButtonElement>(null);
  const openTimer = useRef<number | null>(null);
  useEffect(() => () => { if (openTimer.current !== null) window.clearTimeout(openTimer.current); }, []);
  if (layer === null) return <>{children}</>;

  const here = layer.stack[level];
  const isOpen = here?.id === id;
  const tip = () => ({ id, label, anchor: ref.current!, render: note, beside });
  const cancelOpen = () => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null; }
  };

  const onPointerEnter = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "mouse" || isOpen) return;
    cancelOpen();
    openTimer.current = window.setTimeout(() => { openTimer.current = null; layer.open(level, tip(), false); }, OPEN_DELAY);
  };
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    cancelOpen();
    if (isOpen && here?.locked === true) { layer.closeFrom(level); return; }
    layer.open(level, tip(), true);
    // From the keyboard, pinning is also moving in, so Tab reaches its words.
    if (event.detail === 0) requestAnimationFrame(() => document.getElementById(id)?.focus({ preventScroll: true }));
  };
  const onFocus = () => {
    if (ref.current?.matches(":focus-visible") === true && !isOpen) layer.open(level, tip(), false);
  };
  const onBlur = (event: { relatedTarget: EventTarget | null }) => {
    const into = event.relatedTarget;
    if (into instanceof Node && document.getElementById(id)?.contains(into)) return;
    if (isOpen && here?.locked !== true && !ref.current?.matches(":hover")) layer.closeFrom(level);
  };

  return (
    <button
      ref={ref}
      type="button"
      className={["tip-term", isOpen ? "is-open" : null, className].filter(Boolean).join(" ")}
      aria-expanded={isOpen}
      aria-controls={isOpen ? id : undefined}
      onPointerEnter={onPointerEnter}
      onPointerLeave={cancelOpen}
      onClick={onClick}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {children}
    </button>
  );
}

/** The usual inside of a note: what kind of thing, its name, and the rest. */
export function TipCard({ kicker, title, children }: {
  readonly kicker?: ReactNode;
  readonly title: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="tip__card">
      {kicker !== undefined && <p className="tip__kicker">{kicker}</p>}
      <p className="tip__title">{title}</p>
      {children !== undefined && <div className="tip__body">{children}</div>}
    </div>
  );
}

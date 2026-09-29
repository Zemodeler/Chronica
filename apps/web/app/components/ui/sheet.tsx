"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { TipRoot } from "./tip";

/**
 * A document laid over the room.
 *
 * Every surface the Office opens, and the map's own panels, is one of these.
 * It is a native <dialog> opened with showModal, so focus is held inside it,
 * Escape closes it, and the rest of the page is inert while it is up. The
 * backdrop is the room with the lamp turned down.
 *
 * Before this there were asides that trapped nothing, three dialogs each with
 * its own backdrop, a hand-rolled div for the flag catalog, and six close
 * buttons.
 *
 * `side` puts the sheet on the side of the room away from the object that
 * opened it, so the shelf stays in view beside the book taken from it.
 */

export type SheetWidth = "reading" | "ledger" | "desk" | "narrow";
export type SheetSide = "left" | "right" | "center";
export type SheetTone = "papyrus" | "umber";

export function Sheet({
  label,
  title,
  subtitle,
  width = "ledger",
  side = "right",
  tone = "papyrus",
  open = true,
  onClose,
  actions,
  className,
  children,
}: {
  /** What a screen reader calls it, and what its close button closes. */
  readonly label: string;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly width?: SheetWidth;
  readonly side?: SheetSide;
  readonly tone?: SheetTone;
  readonly open?: boolean;
  readonly onClose: () => void;
  /** Anything that belongs in the header beside the title. */
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Closing by Escape fires the dialog's own close event; closing because the
  // parent said so must not report it back as if the player had.
  const wanted = useRef(open);

  useEffect(() => {
    wanted.current = open;
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal focuses the first control, which is the close button: a
      // ring round "Close" every time a document is picked up. Focus what
      // the sheet asks for instead, or else the document itself, so a screen
      // reader starts at its content and Tab reaches every control from there.
      const wantsFocus = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>(".sheet__body");
      wantsFocus?.focus({ preventScroll: true });
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const reportClose = () => {
    if (!wanted.current) return;
    wanted.current = false;
    onClose();
  };

  // A click that lands on the dialog itself, not on anything inside the
  // frame, is a click on the dimmed room: put the document down.
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) ref.current?.close();
  };

  const classes = [
    "sheet",
    `sheet--${width}`,
    `sheet--${side}`,
    tone === "papyrus" ? "sheet--papyrus on-papyrus" : "sheet--umber",
    className,
  ].filter(Boolean).join(" ");

  return (
    <dialog ref={ref} className={classes} aria-label={label} onClose={reportClose} onClick={onBackdrop}>
      <div className="sheet__frame">
        <header className="sheet__header">
          <div className="sheet__heading">
            <h2 className="sheet__title">{title}</h2>
            {subtitle !== undefined && <p className="sheet__subtitle">{subtitle}</p>}
          </div>
          {actions}
          <CloseButton what={label} onClick={() => ref.current?.close()} />
        </header>
        {/* Reachable by Tab, so a document too long for the sheet can be
            scrolled from the keyboard even when it holds no controls. */}
        <div className="sheet__body" tabIndex={0}><TipRoot>{children}</TipRoot></div>
      </div>
    </dialog>
  );
}

/** The one close control. It says "Close"; its accessible name says what. */
export function CloseButton({ what, onClick }: { readonly what: string; readonly onClick: () => void }) {
  return (
    <button type="button" className="close-button" onClick={onClick} aria-label={`Close ${what}`}>
      Close
    </button>
  );
}

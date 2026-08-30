"use client";

import { useState, useRef } from "react";

interface CharacterRelation {
  readonly name: string;
  readonly relationship: string;
  readonly historical: boolean;
}

export interface CharacterPanelProps {
  readonly characterName: string;
  readonly role: string;
  readonly locationLabel: string;
  readonly culture: string;
  readonly relations: readonly CharacterRelation[];
  readonly origin: string;
  readonly moneyLabel: string;
  /** Older saved characters may not have this field yet. */
  readonly authority?: readonly string[];
}

export function CharacterPanel({ characterName, role, locationLabel, culture, relations, origin, moneyLabel, authority }: CharacterPanelProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  function openPanel() {
    setOpen(true);
    dialogRef.current?.showModal();
  }

  function closePanel() {
    setOpen(false);
    dialogRef.current?.close();
  }

  const significantRelations = relations.filter((r) => r.historical || relations.length <= 4);
  const authorityHoldings = authority ?? [];

  return (
    <>
      {/* Character avatar button — top left, above map controls */}
      <button
        onClick={openPanel}
        aria-label={`Open character panel for ${characterName}`}
        style={{
          position: "fixed",
          top: "4.5rem",
          left: "1rem",
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: "var(--surface)",
          border: "2px solid var(--border)",
          color: "var(--text-title)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.1rem",
          zIndex: 30,
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          transition: "border-color 0.15s",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; }}
      >
        ⚔
      </button>

      {/* Character panel dialog */}
      <dialog
        ref={dialogRef}
        onClose={closePanel}
        style={{
          position: "fixed",
          top: "4.5rem",
          left: "1rem",
          margin: 0,
          width: "min(22rem, calc(100vw - 2rem))",
          maxHeight: "calc(100dvh - 6rem)",
          overflowY: "auto",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          padding: "1.25rem",
          color: "var(--text)",
          zIndex: 40,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
          <div>
            <h2 style={{ margin: 0, color: "var(--text-title)", fontSize: "1.1rem", fontWeight: 700 }}>{characterName}</h2>
            <p style={{ margin: "0.2rem 0 0", color: "var(--text-meta)", fontSize: "0.85rem" }}>{role}</p>
          </div>
          <button
            onClick={closePanel}
            aria-label="Close character panel"
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1.1rem", padding: "0 0 0 0.5rem", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Location */}
        <Section label="Location">
          <span style={{ color: "var(--text)" }}>{locationLabel}</span>
        </Section>

        {/* Culture */}
        <Section label="Culture">
          <span style={{ color: "var(--text)" }}>{culture}</span>
        </Section>

        <Section label="Money">
          <span style={{ color: "var(--text)" }}>{moneyLabel}</span>
        </Section>

        <Section label="Authority">
          {authorityHoldings.length > 0 ? (
            <ul style={{ margin: 0, padding: "0 0 0 1rem", listStyle: "disc" }}>
              {authorityHoldings.map((holding) => <li key={holding} style={{ marginBottom: "0.25rem", fontSize: "0.88rem", color: "var(--text)" }}>{holding}</li>)}
            </ul>
          ) : <span style={{ color: "var(--text)" }}>{role}</span>}
        </Section>

        {/* Origin badge */}
        <Section label="Origin">
          <span style={{
            display: "inline-block",
            padding: "0.15rem 0.55rem",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-pill)",
            fontSize: "0.78rem",
            color: "var(--text-muted)",
          }}>
            {origin === "historical" ? "Historical figure" : origin === "hybrid" ? "Historical (extended)" : "Invented character"}
          </span>
        </Section>

        {/* Relations */}
        {significantRelations.length > 0 && (
          <Section label="Key Relations">
            <ul style={{ margin: 0, padding: "0 0 0 1rem", listStyle: "disc" }}>
              {significantRelations.map((r, i) => (
                <li key={i} style={{ marginBottom: "0.25rem", fontSize: "0.88rem" }}>
                  <strong style={{ color: "var(--text)" }}>{r.name}</strong>
                  <span style={{ color: "var(--text-muted)" }}> — {r.relationship}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

      </dialog>

      {/* Backdrop — closes the panel on outside click */}
      {open && (
        <div
          onClick={closePanel}
          style={{ position: "fixed", inset: 0, zIndex: 35 }}
          aria-hidden
        />
      )}
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "0.85rem" }}>
      <p style={{ margin: "0 0 0.25rem", color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{label}</p>
      {children}
    </div>
  );
}

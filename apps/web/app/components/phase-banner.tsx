import type { GamePhase } from "@chronica/shared";

const descriptions: Record<GamePhase, string> = {
  lobby: "Players are joining and choosing characters.",
  collecting: "The world is waiting for simultaneous orders.",
  queued: "All required orders are in. Resolution is queued.",
  resolving: "The deterministic simulation is resolving this turn.",
  news: "The result is locked while everyone reads the chronicle.",
  resolved: "This turn is complete.",
  finished: "The host ended this match at a safe boundary.",
  failed: "Resolution failed. The last confirmed world remains available.",
  payment_paused: "The match is read-only until the host funds and resumes the exact queued work.",
};

export function PhaseBanner({ phase }: Readonly<{ phase: GamePhase }>) {
  return (
    <aside className={`phase-banner phase-${phase}`} aria-label="Current turn phase">
      <strong key={phase} className="phase-banner-label">{phase.replaceAll("_", " ")}</strong>
      <span key={phase + "-d"} className="phase-banner-desc">{descriptions[phase]}</span>
    </aside>
  );
}

export default function GameLoading() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--background)", gap: "2rem" }}>
      <style>{`
        @keyframes chronicle-ring { 0% { transform: scale(0.85); opacity: 0.6; } 50% { transform: scale(1.05); opacity: 1; } 100% { transform: scale(0.85); opacity: 0.6; } }
        @keyframes chronicle-ring-2 { 0% { transform: scale(1); opacity: 0.3; } 50% { transform: scale(1.18); opacity: 0.6; } 100% { transform: scale(1); opacity: 0.3; } }
        @keyframes chronicle-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>
      <div style={{ position: "relative", width: 72, height: 72 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid var(--accent)", animation: "chronicle-ring 2s ease-in-out infinite" }} />
        <div style={{ position: "absolute", inset: -12, borderRadius: "50%", border: "1px solid var(--accent)", animation: "chronicle-ring-2 2s ease-in-out 0.3s infinite" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem" }}>◎</div>
      </div>
      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.85rem", animation: "chronicle-fade-in 0.4s ease both" }}>Loading your world…</p>
    </div>
  );
}

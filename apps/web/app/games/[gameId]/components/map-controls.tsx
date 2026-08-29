"use client";

export function MapControls({
  onZoomIn,
  onZoomOut,
  canZoomIn,
  canZoomOut,
}: {
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
}) {
  return (
    <div className="map-controls">
      <button
        type="button"
        onClick={onZoomIn}
        disabled={!canZoomIn}
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        type="button"
        onClick={onZoomOut}
        disabled={!canZoomOut}
        aria-label="Zoom out"
      >
        −
      </button>
    </div>
  );
}

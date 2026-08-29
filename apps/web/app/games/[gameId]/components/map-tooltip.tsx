"use client";

export function MapTooltip({
  x,
  y,
  name,
}: {
  readonly x: number;
  readonly y: number;
  readonly name: string;
}) {
  return (
    <div
      className="map-tooltip"
      style={{ left: x + 12, top: y - 8 }}
    >
      {name}
    </div>
  );
}

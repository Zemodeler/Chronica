"use client";

import { forwardRef, useImperativeHandle, useState } from "react";

export interface MapTooltipHandle {
  show: (x: number, y: number, name: string) => void;
  hide: () => void;
}

/**
 * Owns its own state so that hovering from province to province re-renders
 * only this tooltip, not the whole game shell above the map.
 */
export const MapTooltip = forwardRef<MapTooltipHandle>(function MapTooltip(_props, ref) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string } | null>(null);
  useImperativeHandle(ref, () => ({
    show: (x, y, name) => setTooltip({ x, y, name }),
    hide: () => setTooltip(null),
  }), []);
  if (!tooltip) return null;
  return (
    <div
      className="map-tooltip"
      style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
    >
      {tooltip.name}
    </div>
  );
});

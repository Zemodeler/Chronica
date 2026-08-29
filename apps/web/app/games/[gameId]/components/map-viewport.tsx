"use client";

import {
  useRef,
  useCallback,
  type ReactNode,
  type WheelEvent,
  type PointerEvent,
  type KeyboardEvent,
} from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 10;
const ZOOM_STEP = 1.35;
const PAN_PX = 40;

export interface ViewportTransform {
  scale: number;
  tx: number;
  ty: number;
}

interface MapViewportProps {
  readonly transform: ViewportTransform;
  readonly onTransformChange: (t: ViewportTransform) => void;
  readonly children: ReactNode;
}

export function MapViewport({
  transform,
  onTransformChange,
  children,
}: MapViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
  } | null>(null);

  const pinchRef = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    initialDistance: number;
    initialScale: number;
    initialTx: number;
    initialTy: number;
    centerX: number;
    centerY: number;
  } | null>(null);

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const zoomAroundPoint = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;

      const newScale = clampScale(transform.scale * factor);
      const ratio = newScale / transform.scale;

      onTransformChange({
        scale: newScale,
        tx: cx - ratio * (cx - transform.tx),
        ty: cy - ratio * (cy - transform.ty),
      });
    },
    [transform, onTransformChange],
  );

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomAroundPoint(e.clientX, e.clientY, factor);
    },
    [zoomAroundPoint],
  );

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;

      if (pinchRef.current) {
        pinchRef.current.pointers.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
        });
        if (pinchRef.current.pointers.size === 2) {
          const pts = [...pinchRef.current.pointers.values()];
          const dx = pts[1]!.x - pts[0]!.x;
          const dy = pts[1]!.y - pts[0]!.y;
          pinchRef.current.initialDistance = Math.sqrt(dx * dx + dy * dy);
          pinchRef.current.initialScale = transform.scale;
          pinchRef.current.initialTx = transform.tx;
          pinchRef.current.initialTy = transform.ty;
          pinchRef.current.centerX = (pts[0]!.x + pts[1]!.x) / 2;
          pinchRef.current.centerY = (pts[0]!.y + pts[1]!.y) / 2;
        }
        return;
      }

      if (e.pointerType === "touch") {
        pinchRef.current = {
          pointers: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]),
          initialDistance: 0,
          initialScale: transform.scale,
          initialTx: transform.tx,
          initialTy: transform.ty,
          centerX: e.clientX,
          centerY: e.clientY,
        };
        container.setPointerCapture(e.pointerId);
        return;
      }

      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startTx: transform.tx,
        startTy: transform.ty,
      };
      container.setPointerCapture(e.pointerId);
    },
    [transform],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (pinchRef.current) {
        const pinch = pinchRef.current;
        pinch.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch.pointers.size === 2 && pinch.initialDistance > 0) {
          const pts = [...pinch.pointers.values()];
          const dx = pts[1]!.x - pts[0]!.x;
          const dy = pts[1]!.y - pts[0]!.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const factor = dist / pinch.initialDistance;
          const newScale = clampScale(pinch.initialScale * factor);
          const ratio = newScale / pinch.initialScale;

          const container = containerRef.current;
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const cx = pinch.centerX - rect.left;
          const cy = pinch.centerY - rect.top;

          onTransformChange({
            scale: newScale,
            tx: cx - ratio * (cx - pinch.initialTx),
            ty: cy - ratio * (cy - pinch.initialTy),
          });
        }
        return;
      }

      if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      onTransformChange({
        scale: transform.scale,
        tx: dragRef.current.startTx + dx,
        ty: dragRef.current.startTy + dy,
      });
    },
    [transform.scale, onTransformChange],
  );

  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (pinchRef.current) {
      pinchRef.current.pointers.delete(e.pointerId);
      if (pinchRef.current.pointers.size === 0) {
        pinchRef.current = null;
      }
      return;
    }
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          onTransformChange({ ...transform, ty: transform.ty + PAN_PX });
          break;
        case "ArrowDown":
          e.preventDefault();
          onTransformChange({ ...transform, ty: transform.ty - PAN_PX });
          break;
        case "ArrowLeft":
          e.preventDefault();
          onTransformChange({ ...transform, tx: transform.tx + PAN_PX });
          break;
        case "ArrowRight":
          e.preventDefault();
          onTransformChange({ ...transform, tx: transform.tx - PAN_PX });
          break;
        case "+":
        case "=":
          e.preventDefault();
          onTransformChange({
            ...transform,
            scale: clampScale(transform.scale * ZOOM_STEP),
          });
          break;
        case "-":
          e.preventDefault();
          onTransformChange({
            ...transform,
            scale: clampScale(transform.scale / ZOOM_STEP),
          });
          break;
      }
    },
    [transform, onTransformChange],
  );

  return (
    <figure
      ref={containerRef}
      className="map-frame map-frame-interactive"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="application"
      aria-label="World map"
      style={{ touchAction: "none" }}
    >
      <div
        style={{
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
          width: "100%",
          height: "100%",
        }}
      >
        {children}
      </div>
    </figure>
  );
}

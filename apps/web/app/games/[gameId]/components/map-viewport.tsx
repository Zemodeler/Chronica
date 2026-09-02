"use client";

import {
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  forwardRef,
  type ReactNode,
  type WheelEvent,
  type PointerEvent,
  type KeyboardEvent,
} from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 80;
const ZOOM_STEP = 1.35;
const PAN_PX = 40;
const MEDIUM_THRESHOLD = 2.5;
const CLOSE_THRESHOLD = 5;

export interface ViewportTransform {
  scale: number;
  tx: number;
  ty: number;
}

export interface MapViewportHandle {
  /** Trigger an immediate canvas redraw using the current live transform. */
  redrawCanvas: () => void;
}

/** Callback signature for canvas terrain drawing. */
export type DrawCanvasFn = (
  canvas: HTMLCanvasElement,
  transform: ViewportTransform,
  containerW: number,
  containerH: number,
) => void;

function deriveZoomBand(scale: number): "far" | "medium" | "close" {
  if (scale >= CLOSE_THRESHOLD) return "close";
  if (scale >= MEDIUM_THRESHOLD) return "medium";
  return "far";
}

interface MapViewportProps {
  readonly transform: ViewportTransform;
  readonly onTransformChange: (t: ViewportTransform) => void;
  readonly children: ReactNode;
  /** Called each animation frame during gestures to repaint the terrain canvas. */
  readonly onDrawCanvas?: DrawCanvasFn;
}

export const MapViewport = forwardRef<MapViewportHandle, MapViewportProps>(
  function MapViewport({ transform, onTransformChange, children, onDrawCanvas }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Live transform — mutated directly during gestures, never triggers React re-renders
    const liveRef = useRef<ViewportTransform>(transform);
    const zoomBandRef = useRef(deriveZoomBand(transform.scale));
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rafRef = useRef<number | null>(null);

    // Keep the draw callback in a ref so applyTransform always calls the latest version
    const drawCanvasRef = useRef<DrawCanvasFn | undefined>(onDrawCanvas);
    useEffect(() => { drawCanvasRef.current = onDrawCanvas; }, [onDrawCanvas]);

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

    const scheduleCanvasDraw = useCallback((t: ViewportTransform) => {
      if (!drawCanvasRef.current || !canvasRef.current || !containerRef.current) return;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const canvas = canvasRef.current;
      const container = containerRef.current;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (drawCanvasRef.current) {
          drawCanvasRef.current(canvas, t, container.clientWidth, container.clientHeight);
        }
      });
    }, []);

    // Write the CSS transform directly to the DOM — zero React re-renders per frame
    const applyTransform = useCallback((t: ViewportTransform) => {
      liveRef.current = t;
      const wrapper = wrapperRef.current;
      if (wrapper) {
        wrapper.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`;
      }
      scheduleCanvasDraw(t);
    }, [scheduleCanvasDraw]);

    // Notify parent: immediate on zoom band crossing so LOD switches instantly,
    // debounced otherwise (end of pan / end of free zoom).
    const commitTransform = useCallback((t: ViewportTransform) => {
      const newBand = deriveZoomBand(t.scale);
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      if (newBand !== zoomBandRef.current) {
        zoomBandRef.current = newBand;
        onTransformChange(t);
      } else {
        commitTimerRef.current = setTimeout(() => {
          onTransformChange(liveRef.current);
        }, 100);
      }
    }, [onTransformChange]);

    const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

    useImperativeHandle(ref, () => ({
      redrawCanvas() {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (canvas && container && drawCanvasRef.current) {
          drawCanvasRef.current(canvas, liveRef.current, container.clientWidth, container.clientHeight);
        }
      },
    }), []);

    // Set initial CSS transform and canvas before first paint
    useLayoutEffect(() => {
      applyTransform(transform);
    }, []); // intentional empty deps: run once on mount only

    // Sync external prop changes (zoom buttons, keyboard in parent) to the DOM.
    // Skip during active gestures so we don't fight the live ref.
    useEffect(() => {
      if (!dragRef.current && !pinchRef.current) {
        applyTransform(transform);
        zoomBandRef.current = deriveZoomBand(transform.scale);
      }
    }, [transform, applyTransform]);

    const zoomAroundPoint = useCallback(
      (clientX: number, clientY: number, factor: number) => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const cx = clientX - rect.left;
        const cy = clientY - rect.top;
        const live = liveRef.current;
        const newScale = clampScale(live.scale * factor);
        const ratio = newScale / live.scale;
        const next: ViewportTransform = {
          scale: newScale,
          tx: cx - ratio * (cx - live.tx),
          ty: cy - ratio * (cy - live.ty),
        };
        applyTransform(next);
        commitTransform(next);
      },
      [applyTransform, commitTransform],
    );

    const handleWheel = useCallback(
      (e: WheelEvent) => {
        e.preventDefault();
        zoomAroundPoint(e.clientX, e.clientY, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      },
      [zoomAroundPoint],
    );

    const handlePointerDown = useCallback((e: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;

      if (pinchRef.current) {
        pinchRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinchRef.current.pointers.size === 2) {
          const pts = [...pinchRef.current.pointers.values()];
          const dx = pts[1]!.x - pts[0]!.x;
          const dy = pts[1]!.y - pts[0]!.y;
          pinchRef.current.initialDistance = Math.sqrt(dx * dx + dy * dy);
          const live = liveRef.current;
          pinchRef.current.initialScale = live.scale;
          pinchRef.current.initialTx = live.tx;
          pinchRef.current.initialTy = live.ty;
          pinchRef.current.centerX = (pts[0]!.x + pts[1]!.x) / 2;
          pinchRef.current.centerY = (pts[0]!.y + pts[1]!.y) / 2;
        }
        return;
      }

      if (e.pointerType === "touch") {
        const live = liveRef.current;
        pinchRef.current = {
          pointers: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]),
          initialDistance: 0,
          initialScale: live.scale,
          initialTx: live.tx,
          initialTy: live.ty,
          centerX: e.clientX,
          centerY: e.clientY,
        };
        container.setPointerCapture(e.pointerId);
        return;
      }

      const live = liveRef.current;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startTx: live.tx,
        startTy: live.ty,
      };
      container.setPointerCapture(e.pointerId);
    }, []);

    const handlePointerMove = useCallback((e: PointerEvent) => {
      if (pinchRef.current) {
        const pinch = pinchRef.current;
        pinch.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch.pointers.size === 2 && pinch.initialDistance > 0) {
          const pts = [...pinch.pointers.values()];
          const dx = pts[1]!.x - pts[0]!.x;
          const dy = pts[1]!.y - pts[0]!.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const newScale = clampScale(pinch.initialScale * (dist / pinch.initialDistance));
          const ratio = newScale / pinch.initialScale;

          const container = containerRef.current;
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const cx = pinch.centerX - rect.left;
          const cy = pinch.centerY - rect.top;

          const next: ViewportTransform = {
            scale: newScale,
            tx: cx - ratio * (cx - pinch.initialTx),
            ty: cy - ratio * (cy - pinch.initialTy),
          };
          applyTransform(next);
          commitTransform(next);
        }
        return;
      }

      if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
      // Panning never changes zoom band — apply to DOM only, no React re-render
      applyTransform({
        scale: liveRef.current.scale,
        tx: dragRef.current.startTx + (e.clientX - dragRef.current.startX),
        ty: dragRef.current.startTy + (e.clientY - dragRef.current.startY),
      });
    }, [applyTransform, commitTransform]);

    const handlePointerUp = useCallback((e: PointerEvent) => {
      if (pinchRef.current) {
        pinchRef.current.pointers.delete(e.pointerId);
        if (pinchRef.current.pointers.size === 0) {
          pinchRef.current = null;
          onTransformChange(liveRef.current);
        }
        return;
      }
      if (dragRef.current?.pointerId === e.pointerId) {
        dragRef.current = null;
        onTransformChange(liveRef.current);
      }
    }, [onTransformChange]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
      let next: ViewportTransform | null = null;
      const live = liveRef.current;
      switch (e.key) {
        case "ArrowUp":    e.preventDefault(); next = { ...live, ty: live.ty + PAN_PX }; break;
        case "ArrowDown":  e.preventDefault(); next = { ...live, ty: live.ty - PAN_PX }; break;
        case "ArrowLeft":  e.preventDefault(); next = { ...live, tx: live.tx + PAN_PX }; break;
        case "ArrowRight": e.preventDefault(); next = { ...live, tx: live.tx - PAN_PX }; break;
        case "+":
        case "=":          e.preventDefault(); next = { ...live, scale: clampScale(live.scale * ZOOM_STEP) }; break;
        case "-":          e.preventDefault(); next = { ...live, scale: clampScale(live.scale / ZOOM_STEP) }; break;
      }
      if (next) {
        applyTransform(next);
        onTransformChange(next);
      }
    }, [applyTransform, onTransformChange]);

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
        style={{ touchAction: "none", position: "relative" }}
      >
        {/* Canvas for static terrain — lives outside the CSS transform so it
            never gets compositor-rasterised; we redraw it manually each frame */}
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, pointerEvents: "none", display: "block" }}
        />
        <div
          ref={wrapperRef}
          style={{
            position: "relative",
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
);

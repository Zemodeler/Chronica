"use client";

import {
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  forwardRef,
  type ReactNode,
  type MouseEvent,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { clampPan, clampScale, wheelZoomFactor, zoomAbout } from "./wheel-zoom";

const ZOOM_STEP = 1.35;
const PAN_PX = 40;
// How far a pressed pointer travels before it is a drag rather than a click.
// Below it the map stays put, so a hand's tremor still selects a province.
const DRAG_THRESHOLD_PX = 4;
const MEDIUM_THRESHOLD = 2.5;
const CLOSE_THRESHOLD = 5;
// How long after the last pan/zoom input the map counts as settled. While it
// is not, the terrain renderer may not start an expensive cache rebuild.
const SETTLE_MS = 150;

export interface ViewportTransform {
  scale: number;
  tx: number;
  ty: number;
}

export interface MapViewportHandle {
  /** Ask for a canvas repaint on the next frame. Any number of requests in
   *  one frame, from a gesture, a data change or the pulse, paint once. */
  requestRedraw: () => void;
  /** Return the current live viewport transform. */
  liveTransform: () => ViewportTransform;
}

/** Callback signature for canvas terrain drawing. */
export type DrawCanvasFn = (
  canvas: HTMLCanvasElement,
  transform: ViewportTransform,
  containerW: number,
  containerH: number,
  /** True while a pan or zoom is still under way (see SETTLE_MS). */
  interacting: boolean,
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
  /** Clears map hover state before the SVG is moved beneath a captured pointer. */
  readonly onPanStart?: () => void;
}

export const MapViewport = forwardRef<MapViewportHandle, MapViewportProps>(
  function MapViewport({ transform, onTransformChange, children, onDrawCanvas, onPanStart }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Live transform — mutated directly during gestures, never triggers React re-renders
    const liveRef = useRef<ViewportTransform>(transform);
    const zoomBandRef = useRef(deriveZoomBand(transform.scale));
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const interactingRef = useRef(false);
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
      hasPanned: boolean;
    } | null>(null);

    const pinchRef = useRef<{
      pointers: Map<number, { x: number; y: number }>;
      initialDistance: number;
      initialScale: number;
      initialTx: number;
      initialTy: number;
      centerX: number;
      centerY: number;
      hasPanned: boolean;
    } | null>(null);

    // Set when a gesture panned, so the click the browser fires at the end of
    // it does not also select whatever province the pointer came to rest on.
    const swallowClickRef = useRef(false);

    // One pending frame at most: every caller only marks the canvas dirty,
    // and the frame paints the live transform as it stands by then.
    const requestRedraw = useCallback(() => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (drawCanvasRef.current && canvas && container) {
          drawCanvasRef.current(canvas, liveRef.current, container.clientWidth, container.clientHeight, interactingRef.current);
        }
      });
    }, []);

    // Every pan/zoom input restarts the settle timer; when it runs out, one
    // more paint lets the renderer do the work it deferred during the gesture.
    const markInteracting = useCallback(() => {
      interactingRef.current = true;
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        interactingRef.current = false;
        requestRedraw();
      }, SETTLE_MS);
    }, [requestRedraw]);

    // Write the CSS transform directly to the DOM — zero React re-renders per frame
    const applyTransform = useCallback((requested: ViewportTransform) => {
      // The map may not be dragged out of the view (see clampPan).
      const container = containerRef.current;
      const t = container ? clampPan(requested, container.clientWidth, container.clientHeight) : requested;
      liveRef.current = t;
      const wrapper = wrapperRef.current;
      if (wrapper) {
        wrapper.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`;
      }
      requestRedraw();
    }, [requestRedraw]);

    const setPanning = useCallback((panning: boolean) => {
      containerRef.current?.toggleAttribute("data-panning", panning);
    }, []);

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

    useImperativeHandle(ref, () => ({
      requestRedraw,
      liveTransform() { return liveRef.current; },
    }), [requestRedraw]);

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

    // A layout change (resizing the window or opening a panel) used to leave
    // the canvas at its old backing-store size until the next map gesture.
    // Redrawing on the next frame keeps the map sharp throughout the resize
    // without synchronously painting for every ResizeObserver notification.
    useEffect(() => {
      const container = containerRef.current;
      if (!container || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(requestRedraw);
      observer.observe(container);
      return () => observer.disconnect();
    }, [requestRedraw]);

    // Moving the window to a screen of another pixel density changes
    // devicePixelRatio without resizing anything, which left the canvas at
    // the old backing-store resolution. A resolution query matches only the
    // current ratio, so it is re-armed for the new one each time it fires.
    useEffect(() => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
      let query: MediaQueryList | null = null;
      const arm = () => {
        query?.removeEventListener("change", onChange);
        query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        query.addEventListener("change", onChange);
      };
      function onChange() {
        arm();
        requestRedraw();
      }
      arm();
      return () => query?.removeEventListener("change", onChange);
    }, [requestRedraw]);

    useEffect(() => () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    }, []);

    const zoomAroundPoint = useCallback(
      (clientX: number, clientY: number, factor: number) => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const cx = clientX - rect.left;
        const cy = clientY - rect.top;
        const next = zoomAbout(liveRef.current, cx, cy, factor);
        markInteracting();
        applyTransform(next);
        commitTransform(next);
      },
      [applyTransform, commitTransform, markInteracting],
    );

    // A wheel over the map zooms the map and does nothing else: it must not
    // scroll the page, and with ctrl held (a pinch, or ctrl + wheel) it must not
    // zoom the browser's page. Both need preventDefault, which React's onWheel
    // (a passive listener on the root) is not allowed to call, so the listener
    // is added by hand, non-passive, and taken off with the frame.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const onWheel = (e: globalThis.WheelEvent) => {
        e.preventDefault();
        zoomAroundPoint(e.clientX, e.clientY, wheelZoomFactor(e));
      };
      container.addEventListener("wheel", onWheel, { passive: false });
      return () => container.removeEventListener("wheel", onWheel);
    }, [zoomAroundPoint]);

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
          hasPanned: false,
        };
        return;
      }

      const live = liveRef.current;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startTx: live.tx,
        startTy: live.ty,
        hasPanned: false,
      };
      // No pointer capture yet. Captured to the frame, the click that ends a
      // press is dispatched to the frame and never reaches the map's own
      // click handler, so capture waits until the press becomes a drag.
    }, []);

    const handlePointerMove = useCallback((e: PointerEvent) => {
      if (pinchRef.current) {
        const pinch = pinchRef.current;
        pinch.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch.pointers.size === 2 && pinch.initialDistance > 0) {
          if (!pinch.hasPanned) {
            pinch.hasPanned = true;
            for (const id of pinch.pointers.keys()) containerRef.current?.setPointerCapture(id);
            setPanning(true);
            onPanStart?.();
          }
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
          markInteracting();
          applyTransform(next);
          commitTransform(next);
        }
        return;
      }

      if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
      // Panning never changes zoom band — apply to DOM only, no React re-render
      if (!dragRef.current.hasPanned) {
        if (Math.hypot(e.clientX - dragRef.current.startX, e.clientY - dragRef.current.startY) < DRAG_THRESHOLD_PX) return;
        dragRef.current.hasPanned = true;
        containerRef.current?.setPointerCapture(e.pointerId);
        setPanning(true);
        onPanStart?.();
      }
      markInteracting();
      applyTransform({
        scale: liveRef.current.scale,
        tx: dragRef.current.startTx + (e.clientX - dragRef.current.startX),
        ty: dragRef.current.startTy + (e.clientY - dragRef.current.startY),
      });
    }, [applyTransform, commitTransform, markInteracting, onPanStart, setPanning]);

    const handlePointerUp = useCallback((e: PointerEvent) => {
      if (pinchRef.current) {
        pinchRef.current.pointers.delete(e.pointerId);
        if (pinchRef.current.pointers.size === 0) {
          swallowClickRef.current = pinchRef.current.hasPanned;
          pinchRef.current = null;
          setPanning(false);
          onTransformChange(liveRef.current);
        }
        return;
      }
      if (dragRef.current?.pointerId === e.pointerId) {
        swallowClickRef.current = dragRef.current.hasPanned;
        dragRef.current = null;
        setPanning(false);
        onTransformChange(liveRef.current);
      }
    }, [onTransformChange, setPanning]);

    // A pan whose click never came must not eat the next real one. Cleared in
    // the capture phase, because a press on an army standard stops before it
    // bubbles up to `handlePointerDown`, and a pan that ended just before it
    // then ate the click that should have opened the army.
    const handlePointerDownCapture = useCallback(() => {
      swallowClickRef.current = false;
    }, []);

    const handleClickCapture = useCallback((e: MouseEvent) => {
      if (!swallowClickRef.current) return;
      swallowClickRef.current = false;
      e.stopPropagation();
    }, []);

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
        markInteracting();
        applyTransform(next);
        onTransformChange(next);
      }
    }, [applyTransform, markInteracting, onTransformChange]);

    return (
      <figure
        ref={containerRef}
        className="map-frame map-frame-interactive"
        onPointerDownCapture={handlePointerDownCapture}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={handleClickCapture}
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

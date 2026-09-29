/**
 * The wheel's zoom, as arithmetic (the viewport applies it, map-viewport.tsx).
 *
 * Wheels differ by orders of magnitude: a mouse notch is 100 pixels (or 3
 * lines, which a browser may report in lines), a trackpad's two-finger scroll
 * a stream of a few pixels, a pinch (which browsers send as a wheel with ctrl
 * held) a stream of ones and twos. An exponential response makes each of them
 * continuous and reversible: opposite deltas cancel exactly, and the same
 * total travel zooms the same however it was cut up.
 */
export interface ZoomTransform { readonly scale: number; readonly tx: number; readonly ty: number; }

export const MIN_SCALE = 1;
export const MAX_SCALE = 80;
/** The zoom per pixel of wheel travel: a 100 px notch is about 22%. */
export const WHEEL_ZOOM_SENSITIVITY = .0025;
/** A pinch moves less per event than a wheel does, so it is given more zoom per unit. */
export const PINCH_ZOOM_SENSITIVITY = .01;
/** One event never zooms by more than this (a notch of a large flywheel mouse would otherwise leap). */
export const MIN_WHEEL_FACTOR = .7;
export const MAX_WHEEL_FACTOR = 1.4;
const PIXELS_PER_LINE = 16;
const PIXELS_PER_PAGE = 320;

export interface WheelInput { readonly deltaY: number; readonly deltaMode: number; readonly ctrlKey: boolean; }

/** The scale factor one wheel event asks for; above 1 zooms in. */
export function wheelZoomFactor({ deltaY, deltaMode, ctrlKey }: WheelInput): number {
  const pixels = deltaY * (deltaMode === 1 ? PIXELS_PER_LINE : deltaMode === 2 ? PIXELS_PER_PAGE : 1);
  const factor = Math.exp(-pixels * (ctrlKey ? PINCH_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY));
  return Math.min(MAX_WHEEL_FACTOR, Math.max(MIN_WHEEL_FACTOR, factor));
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The transform after zooming by `factor` about the point (`cx`, `cy`) of the
 * frame, in the frame's own pixels: the map under that point stays under it.
 * The scale is held between MIN_SCALE and MAX_SCALE, and where it is held the
 * map does not slide.
 */
export function zoomAbout(live: ZoomTransform, cx: number, cy: number, factor: number): ZoomTransform {
  const scale = clampScale(live.scale * factor);
  const ratio = scale / live.scale;
  return { scale, tx: cx - ratio * (cx - live.tx), ty: cy - ratio * (cy - live.ty) };
}

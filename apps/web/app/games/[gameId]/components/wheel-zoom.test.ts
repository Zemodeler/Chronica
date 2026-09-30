import { describe, expect, it } from "vitest";
import { MAX_SCALE, MAX_WHEEL_FACTOR, MIN_SCALE, MIN_WHEEL_FACTOR, PAN_OVERSCROLL, clampPan, wheelZoomFactor, zoomAbout } from "./wheel-zoom";

const pixels = (deltaY: number, ctrlKey = false) => ({ deltaY, deltaMode: 0, ctrlKey });

describe("how far a wheel event zooms", () => {
  it("zooms in for a scroll up and out for a scroll down, and opposite deltas cancel", () => {
    expect(wheelZoomFactor(pixels(-100))).toBeGreaterThan(1);
    expect(wheelZoomFactor(pixels(100))).toBeLessThan(1);
    expect(wheelZoomFactor(pixels(-100)) * wheelZoomFactor(pixels(100))).toBeCloseTo(1, 10);
  });

  it("gives the same zoom for the same travel however it is cut up", () => {
    const notch = wheelZoomFactor(pixels(-60));
    let stream = 1;
    for (let i = 0; i < 60; i++) stream *= wheelZoomFactor(pixels(-1));
    expect(stream).toBeCloseTo(notch, 6);
  });

  it("reads lines and pages as the pixels they stand for", () => {
    expect(wheelZoomFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false })).toBeCloseTo(wheelZoomFactor(pixels(-48)), 10);
    expect(wheelZoomFactor({ deltaY: -1, deltaMode: 2, ctrlKey: false })).toBeCloseTo(wheelZoomFactor(pixels(-320)), 10);
  });

  it("zooms a pinch further than a wheel for the same delta, and never more than the cap in one event", () => {
    expect(wheelZoomFactor(pixels(-5, true))).toBeGreaterThan(wheelZoomFactor(pixels(-5)));
    expect(wheelZoomFactor(pixels(-100000))).toBe(MAX_WHEEL_FACTOR);
    expect(wheelZoomFactor(pixels(100000))).toBe(MIN_WHEEL_FACTOR);
  });
});

describe("zooming about the cursor", () => {
  const start = { scale: 2, tx: -300, ty: -120 };

  it("keeps the map point under the cursor where it is", () => {
    const next = zoomAbout(start, 640, 380, 1.3);
    const under = (t: typeof start) => [(640 - t.tx) / t.scale, (380 - t.ty) / t.scale];
    expect(under(next)[0]).toBeCloseTo(under(start)[0]!, 9);
    expect(under(next)[1]).toBeCloseTo(under(start)[1]!, 9);
    expect(next.scale).toBeCloseTo(2.6, 10);
  });

  it("holds the scale between the minimum and the maximum, and does not slide the map where it is held", () => {
    const top = zoomAbout({ scale: MAX_SCALE, tx: -5000, ty: -4000 }, 500, 500, 1.4);
    expect(top).toEqual({ scale: MAX_SCALE, tx: -5000, ty: -4000 });
    const bottom = zoomAbout({ scale: MIN_SCALE, tx: 0, ty: 0 }, 500, 500, .7);
    expect(bottom).toEqual({ scale: MIN_SCALE, tx: 0, ty: 0 });
    expect(zoomAbout({ scale: 79, tx: 0, ty: 0 }, 0, 0, 1.4).scale).toBe(MAX_SCALE);
  });

  it("is undone by the opposite zoom", () => {
    const there = zoomAbout(start, 900, 500, 1.25);
    const back = zoomAbout(there, 900, 500, 1 / 1.25);
    expect(back.scale).toBeCloseTo(start.scale, 10);
    expect(back.tx).toBeCloseTo(start.tx, 8);
    expect(back.ty).toBeCloseTo(start.ty, 8);
  });
});

describe("keeping the map in the view", () => {
  const W = 1600, H = 1000;

  it("leaves a pan alone while the map still fills the view", () => {
    const t = { scale: 4, tx: -900, ty: -1200 };
    expect(clampPan(t, W, H)).toBe(t);
  });

  it("stops the map's edges being dragged in past the view's, less the overscroll", () => {
    const right = clampPan({ scale: 4, tx: 5000, ty: -100 }, W, H);
    expect(right.tx).toBeCloseTo(W * PAN_OVERSCROLL, 9);
    const left = clampPan({ scale: 4, tx: -99999, ty: -100 }, W, H);
    expect(left.tx).toBeCloseTo(W * (1 - 4) - W * PAN_OVERSCROLL, 9);
    const down = clampPan({ scale: 2, tx: 0, ty: 4000 }, W, H);
    expect(down.ty).toBeCloseTo(H * PAN_OVERSCROLL, 9);
    const up = clampPan({ scale: 2, tx: 0, ty: -4000 }, W, H);
    expect(up.ty).toBeCloseTo(H * (1 - 2) - H * PAN_OVERSCROLL, 9);
  });

  it("at scale 1 leaves only the overscroll, and never changes the scale", () => {
    const t = clampPan({ scale: 1, tx: 700, ty: -700 }, W, H);
    expect(t).toEqual({ scale: 1, tx: W * PAN_OVERSCROLL, ty: -H * PAN_OVERSCROLL });
  });

  it("does nothing for a view without size", () => {
    const t = { scale: 3, tx: 9999, ty: 9999 };
    expect(clampPan(t, 0, 0)).toBe(t);
  });
});

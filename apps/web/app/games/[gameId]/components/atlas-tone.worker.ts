/// <reference lib="webworker" />
import { toneAtlas } from "./atlas-tone";

/**
 * Tones a map raster off the main thread. A 4096px relief is seventy
 * megabytes of pixels; walking them on the page would freeze it for the
 * moment the map first appears.
 */
declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<{ readonly id: number; readonly bitmap: ImageBitmap }>) => {
  const { id, bitmap } = event.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    toneAtlas(image.data);
    ctx.putImageData(image, 0, 0);
    const toned = canvas.transferToImageBitmap();
    self.postMessage({ id, bitmap: toned }, [toned]);
  } catch {
    self.postMessage({ id, bitmap: null });
  }
};

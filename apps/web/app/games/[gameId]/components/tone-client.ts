let _toneWorker: Worker | null | undefined;
let _toneRequests = 0;

/**
 * Tones a raster (or one tile of it) into the engraved plate, off the main
 * thread (see atlas-tone.ts and atlas-tone.worker.ts). The bitmap is handed to
 * the worker and is no longer usable here. Null where there is no worker or
 * toning failed: the caller decides whether an untoned image is better than none.
 */
export async function toneBitmap(raw: ImageBitmap): Promise<ImageBitmap | null> {
  if (_toneWorker === undefined) {
    try { _toneWorker = new Worker(new URL("./atlas-tone.worker.ts", import.meta.url)); } catch { _toneWorker = null; }
  }
  const worker = _toneWorker;
  if (worker === null) { raw.close(); return null; }
  const id = ++_toneRequests;
  return new Promise<ImageBitmap | null>((resolve) => {
    const onMessage = (event: MessageEvent<{ readonly id: number; readonly bitmap: ImageBitmap | null }>) => {
      if (event.data.id !== id) return;
      worker.removeEventListener("message", onMessage);
      resolve(event.data.bitmap);
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({ id, bitmap: raw }, [raw]);
  });
}

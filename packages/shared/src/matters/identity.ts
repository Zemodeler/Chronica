/**
 * Matter identity and deduplication (docs/plans/ai-world-matters-runtime.md,
 * "Matter identity and deduplication"). Every detector derives a stable id
 * from its source and due period so re-running detection at the same world
 * instant refreshes the same record instead of creating another.
 */

/**
 * Builds a matter id from its source and, for periodic matters, the period
 * it concerns -- e.g. `matterIdFor("obligation", "legio-i-pay", "period-12")`
 * -> `"obligation:legio-i-pay:period-12"`. A continuous-condition matter
 * (scarcity, an unfilled vacancy, interrupted trade -- see the doc) has no
 * period and passes `null`, producing the legacy `WorldDevelopment` form
 * unchanged: `matterIdFor("scarcity", provinceId, null)` ->
 * `"scarcity:<provinceId>"`, so ids ported from `WorldDevelopment` migrate
 * without change.
 */
export function matterIdFor(sourceKind: string, sourceId: string, periodKey: string | null): string {
  return periodKey === null ? `${sourceKind}:${sourceId}` : `${sourceKind}:${sourceId}:${periodKey}`;
}

/**
 * Deterministic period index for a periodic matter: how many whole
 * `cadenceSteps` have elapsed between the matter's creation and its next
 * due step. Advancing `nextDueStep` by exactly one `cadenceSteps` always
 * advances the returned index by exactly one.
 */
export function periodIndexFor(nextDueStep: number, cadenceSteps: number, createdAtStep: number): number {
  const cadence = Math.max(1, Math.floor(cadenceSteps));
  return Math.max(0, Math.floor((nextDueStep - createdAtStep) / cadence));
}

/**
 * Suffix distinguishing a reopened occurrence of a continuous-condition
 * matter (docs: "may reopen as a new occurrence if it later returns") from
 * its first appearance. Scheme: empty for the first occurrence
 * (`reopenCount` 0), then `:occurrence-2`, `:occurrence-3`, ... for each
 * subsequent reopening (`reopenCount` 1, 2, ...). Deterministic and
 * distinct per `reopenCount`.
 */
export function occurrenceSuffix(reopenCount: number): string {
  return reopenCount <= 0 ? "" : `:occurrence-${reopenCount + 1}`;
}

// -- Legacy pressure-id compatibility -----------------------------------
//
// The pre-matters scheduler (`world-development-scheduler.ts`) derived a
// `CharacterPressure` id from a development's id as
// `development:${sha256(id).hex.slice(0, 32)}`, computed with Node's
// `crypto` module. Migrating a `WorldDevelopment` into a `WorldMatter` must
// set `pressureId` to that exact same value so the migration neither
// duplicates nor orphans the pressure row already sitting in
// `world.characterPressures`. This package stays isomorphic (no `node:`
// imports -- see `workflows/definitions/*.ts`'s use of `globalThis.crypto`
// instead of `node:crypto`), so this is a small dependency-free SHA-256
// (FIPS 180-4), not a call into Node's `crypto`. Any correct SHA-256
// implementation reproduces byte-identical output to
// `crypto.createHash("sha256")` for the same input -- verified directly
// against it in `migration.test.ts`.

const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Pure SHA-256 over a UTF-8 string, returned as lowercase hex -- see the module comment above. */
function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLength = bytes.length * 8;
  const paddedLength = (bytes.length + 9 + 63) & ~63;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const wi15 = w[i - 15]!;
      const wi2 = w[i - 2]!;
      const s0 = rotr(wi15, 7) ^ rotr(wi15, 18) ^ (wi15 >>> 3);
      const s1 = rotr(wi2, 17) ^ rotr(wi2, 19) ^ (wi2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i]! + w[i]!) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}

/**
 * The `CharacterPressure` id a matter (or, before it, its `WorldDevelopment`
 * predecessor) resolves/refreshes through -- see the module comment above.
 * Kept under the historical `development:` prefix intentionally: a freshly
 * detected matter reuses the exact same source-derived id a
 * `WorldDevelopment` would have (`scarcity:<provinceId>`, etc.), so this
 * must produce the exact same pressure id too, for continuity with any
 * pressure a pre-migration game already created.
 */
export function matterPressureId(matterId: string): string {
  return `development:${sha256Hex(matterId).slice(0, 32)}`;
}

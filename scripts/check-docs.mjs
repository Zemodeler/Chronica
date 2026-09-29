// Do the docs point at things that exist?
//
// The living docs -- README, DESIGN, PRODUCT and docs/*.md -- name source
// files by path, and a doc that sends a reader to a file that was deleted or
// renamed is worse than one that names nothing. This fails on any such path.
//
// Plans (docs/plans/) are records of what was intended at the time, and name
// files that were deleted on purpose, so they are not checked. Comments in the
// code that cite a doc by path are listed as warnings: several still cite the
// numbered documents of an earlier layout ("03-data-model" and its
// siblings) that no longer exist. Pass --strict to fail on those too.
//
//   node scripts/check-docs.mjs [--strict]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

const LIVING_DOCS = ["README.md", "DESIGN.md", "PRODUCT.md", ...readdirSync(path.join(root, "docs")).filter((name) => name.endsWith(".md")).map((name) => `docs/${name}`)];
/** A repository path with an extension, as docs write them: `packages/sim/src/burst.ts`. */
const PATH = /\b(?:apps|packages|scripts|docs)\/[A-Za-z0-9_.[\]/-]+\.(?:ts|tsx|mts|mjs|md|json|sql|css)\b/g;
const DOC_PATH = /\bdocs\/[A-Za-z0-9_./-]+\.md\b/g;
const CODE_DIRS = ["apps", "packages", "scripts"];
const SKIP = new Set(["node_modules", "dist", ".next", "coverage", "test-results"]);

function* codeFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* codeFiles(full);
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) yield full;
  }
}

const missing = (candidate) => !existsSync(path.join(root, candidate));

const broken = [];
for (const doc of LIVING_DOCS) {
  const text = readFileSync(path.join(root, doc), "utf8");
  for (const found of new Set(text.match(PATH) ?? [])) if (missing(found)) broken.push(`${doc}: ${found}`);
}

const stale = [];
for (const dir of CODE_DIRS) {
  for (const file of codeFiles(path.join(root, dir))) {
    const text = readFileSync(file, "utf8");
    for (const found of new Set(text.match(DOC_PATH) ?? [])) if (missing(found)) stale.push(`${path.relative(root, file)}: ${found}`);
  }
}

if (stale.length > 0) console.warn(`Docs: ${stale.length} code comment(s) cite a doc that does not exist:\n${stale.map((line) => `  ${line}`).join("\n")}`);
if (broken.length > 0) console.error(`Docs: ${broken.length} path(s) in the living docs name nothing:\n${broken.map((line) => `  ${line}`).join("\n")}`);
if (broken.length > 0 || (strict && stale.length > 0)) process.exit(1);
console.log(`Docs: every path named in ${LIVING_DOCS.length} living doc(s) exists.`);

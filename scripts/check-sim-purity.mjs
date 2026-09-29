// The determinism gate: no clock, no entropy, in the code a burst replays.
//
// A burst is a pure function of the world it starts from and the model's
// answers (docs/architecture.md; packages/sim/src/a-burst-replayed.test.ts).
// One `Date.now()`, one `Math.random()`, one `crypto.randomUUID()` in the
// engine and a replayed burst writes a different world: hand play stops
// working, and a save can no longer be explained from its own history. Rolls
// are `stableHash`/`stableChoice` (packages/shared/src/determinism.ts); ids
// come from the burst's `IdFactory` (packages/sim/src/ports.ts); time is the
// world's `instant`, passed in.
//
// ESLint says the same in the editor for packages/sim. This is the gate CI
// runs, over packages/sim and packages/shared both -- shared holds the world
// schema, the rules and the resolvers the engine calls -- and it reads the
// syntax tree, so a prompt that mentions Math.random in prose is not a
// violation and a type annotation `: Date` is not one either.
//
//   node scripts/check-sim-purity.mjs        # exits 1 and lists every violation
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCANNED = ["packages/sim/src", "packages/shared/src"];
/** Globals whose every value use is a clock or entropy. */
const FORBIDDEN_GLOBALS = new Map([
  ["Date", "a clock read -- the world's time is `instant`, passed in"],
  ["performance", "a clock read"],
  ["crypto", "entropy -- ids come from the burst's IdFactory"],
]);
const FORBIDDEN_MODULES = new Set(["crypto", "node:crypto"]);

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    // Tests may use whatever they like to build fixtures; they are not replayed.
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

/** Whether this identifier is a name rather than a use: a property, a declaration, a type. */
function isNotAValueUse(node) {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)) && parent.name === node) return true;
  if (ts.isShorthandPropertyAssignment(parent)) return false;
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent) || ts.isQualifiedName(parent)) return true;
  if (ts.isExpressionWithTypeArguments(parent) && ts.isHeritageClause(parent.parent) && parent.parent.token === ts.SyntaxKind.ImplementsKeyword) return true;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumMember(parent) || ts.isBindingElement(parent)) && parent.name === node) return true;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return true;
  return false;
}

/** Every forbidden use in one file, as `file:line:col  what  why`. */
export function violationsIn(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  const report = (node, what, why) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${path.relative(root, file)}:${line + 1}:${character + 1}  ${what}  (${why})`);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && FORBIDDEN_MODULES.has(node.moduleSpecifier.text)) {
      report(node, `import "${node.moduleSpecifier.text}"`, "entropy -- ids come from the burst's IdFactory");
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Math" && node.name.text === "random") {
      report(node, "Math.random", "entropy -- rolls are stableHash/stableChoice");
    } else if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text) && !isNotAValueUse(node)) {
      report(node, node.text, FORBIDDEN_GLOBALS.get(node.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = [];
  let files = 0;
  for (const dir of SCANNED) {
    for (const file of sourceFiles(path.join(root, dir))) {
      files += 1;
      violations.push(...violationsIn(file, readFileSync(file, "utf8")));
    }
  }
  if (violations.length > 0) {
    console.error(`Determinism: ${violations.length} clock or entropy read(s) in replayed code:\n${violations.map((line) => `  ${line}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`Determinism: ${files} file(s) in ${SCANNED.join(", ")} read no clock and no entropy.`);
}

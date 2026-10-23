import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Commits exactly the named files, and nothing else that happens to be staged.
//
//   node scripts/commit-own.mjs "Subject line" path/one path/two ...
//
// Several agents (or sessions) work in one checkout and share one git index, so a plain `git commit` sweeps in
// whatever the others have staged, and a stale index can drop their work. This builds the commit from the branch
// head plus the working-tree contents of the named paths in a private temporary index, then moves the branch with
// a compare-and-swap (it fails, and says so, if the branch moved meanwhile: run it again). The shared index is
// then told about the paths it just committed. Whole files are committed: if a file also holds somebody else's
// unfinished edit, that edit goes in with it, so check `git diff -- <path>` first.
const [subject, ...paths] = process.argv.slice(2);
if (!subject || paths.length === 0) {
  console.error('Usage: node scripts/commit-own.mjs "Subject line" path [path ...]');
  process.exit(1);
}
const trailer = "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>";
const git = (args, env) => execFileSync("git", args, { encoding: "utf8", env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
const index = join(tmpdir(), `commit-own-${process.pid}.index`);
const env = { ...process.env, GIT_INDEX_FILE: index };
try {
  const head = git(["rev-parse", "HEAD"]);
  git(["read-tree", head], env);
  git(["add", "-A", "--", ...paths], env);
  const tree = git(["write-tree"], env);
  if (tree === git(["rev-parse", `${head}^{tree}`])) {
    console.log("Nothing to commit for those paths.");
  } else {
    const commit = git(["commit-tree", tree, "-p", head, "-m", subject, "-m", trailer]);
    git(["update-ref", "-m", `commit-own: ${subject.slice(0, 60)}`, "HEAD", commit, head]);
    git(["reset", "-q", "--", ...paths]);
    console.log(`${commit.slice(0, 7)} ${subject}`);
  }
} catch (error) {
  console.error(String(error.stderr ?? error.message ?? error).trim());
  process.exitCode = 1;
} finally {
  rmSync(index, { force: true });
}

/**
 * Refuse to publish a package that is missing the fields a package needs.
 *
 * `homepage` and `repository` are how package directories and registries link
 * back to a project. Publishing without them, or with a placeholder still in
 * place, is the sort of thing nobody notices until the version is immutable.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const problems = [];
const PLACEHOLDER = /OWNER|example\.com|CHANGE_?ME|TODO/i;

for (const field of ["homepage", "repository", "author"]) {
  const value = pkg[field];
  if (!value) {
    problems.push(`package.json is missing "${field}"`);
    continue;
  }
  const asText = typeof value === "string" ? value : JSON.stringify(value);
  if (PLACEHOLDER.test(asText)) problems.push(`package.json "${field}" is still a placeholder: ${asText}`);
}

if (!existsSync(resolve(here, "..", "fixtures", "cases.json")))
  problems.push("fixtures/cases.json is not in the package; run the build first");

if (!existsSync(resolve(here, "..", "LICENSE")))
  problems.push("LICENSE is not in the package directory");

if (problems.length) {
  console.error("not ready to publish:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("publish checks passed");

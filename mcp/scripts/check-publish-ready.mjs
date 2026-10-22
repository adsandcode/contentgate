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

// The MCP Registry verifies a server by reading mcpName out of the published
// npm package and comparing it with server.json, and it lists whatever
// version server.json claims. Every one of these must agree, or the registry
// rejects the publish or advertises a version npm does not have.
const serverPath = resolve(here, "..", "server.json");
if (!existsSync(serverPath)) {
  problems.push("server.json is missing; the MCP Registry needs it");
} else {
  const server = JSON.parse(readFileSync(serverPath, "utf8"));
  if (!pkg.mcpName) problems.push('package.json is missing "mcpName"');
  else if (pkg.mcpName !== server.name)
    problems.push(`package.json mcpName "${pkg.mcpName}" differs from server.json name "${server.name}"`);
  if (server.version !== pkg.version)
    problems.push(`server.json version ${server.version} differs from package.json version ${pkg.version}`);
  const npmEntry = (server.packages ?? []).find((p) => p.registryType === "npm" && p.identifier === pkg.name);
  if (!npmEntry) problems.push(`server.json has no npm package entry for ${pkg.name}`);
  else if (npmEntry.version !== pkg.version)
    problems.push(`server.json npm package version ${npmEntry.version} differs from package.json version ${pkg.version}`);
  if (typeof server.description !== "string" || server.description.length > 100)
    problems.push("server.json description must be a string of at most 100 characters");
}

// The version the server reports to clients over MCP.
const indexSrc = resolve(here, "..", "src", "index.ts");
if (existsSync(indexSrc)) {
  const m = /export const VERSION = "([^"]+)"/.exec(readFileSync(indexSrc, "utf8"));
  if (!m) problems.push("src/index.ts does not declare VERSION");
  else if (m[1] !== pkg.version)
    problems.push(`src/index.ts VERSION ${m[1]} differs from package.json version ${pkg.version}`);
}

if (problems.length) {
  console.error("not ready to publish:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("publish checks passed");

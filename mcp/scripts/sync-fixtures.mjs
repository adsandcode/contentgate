/**
 * Copy the shared fixture file into the package so it survives `npm pack`.
 *
 * The fixtures are the contract between the two implementations, so they live
 * at the top of the repository. npm only publishes what is inside the package
 * directory, and the server refuses to start without them, so a published
 * package missing this copy would be dead on arrival.
 */
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "..", "..", "fixtures", "cases.json");
const targetDir = resolve(here, "..", "fixtures");
const target = resolve(targetDir, "cases.json");

if (!existsSync(source)) {
  // Building from an unpacked tarball: the copy is already in place.
  if (existsSync(target)) {
    console.log("fixtures: using the packaged copy");
    process.exit(0);
  }
  console.error("fixtures: cannot find " + source);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log("fixtures: synced to " + target);

/**
 * Runs the shared fixture file. Same cases, same expected verdicts as Python.
 * A disagreement here means the two implementations have drifted.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  checkKeywords, checkTranslation, checkInternalLinks, checkClaims,
  contentHash, resolveLastmod, DEFAULT_PRIMARY_MIN_HITS,
} from "./guards.js";

const here = dirname(fileURLToPath(import.meta.url));

// Inside the published package the fixtures sit next to dist/, copied there by
// the prebuild step. In the repo they live at the top level, shared with the
// Python implementation. A published package that cannot find its own tests
// would refuse to start, so both locations are tried.
const CANDIDATES = [
  resolve(here, "..", "fixtures", "cases.json"),
  resolve(here, "..", "..", "fixtures", "cases.json"),
];

export const FIXTURES = CANDIDATES.find(existsSync) ?? CANDIDATES[0];

type Verdict = "pass" | "block";

interface Case { guard: string; name: string; expect: Verdict; input: Record<string, any>; }

export function verdict(c: Case): Verdict {
  const i = c.input;
  switch (c.guard) {
    case "keywords": {
      const { problems } = checkKeywords(
        i.html, i.keywords, i.scope ?? null, i.exclude_classes ?? [],
        i.primary_min_hits ?? DEFAULT_PRIMARY_MIN_HITS);
      return problems.length ? "block" : "pass";
    }
    case "translation": {
      const problems = checkTranslation(i.source, i.translation, i.locale, {
        forbidSourceScript: i.forbid_source_script ?? true,
        checkLocalePrefix: i.check_locale_prefix ?? true,
      });
      return problems.length ? "block" : "pass";
    }
    case "internal_links": {
      const { problems } = checkInternalLinks(
        i.html, i.money_paths, i.scope ?? null, i.exclude_classes ?? [],
        i.require_figure ?? false);
      return problems.length ? "block" : "pass";
    }
    case "claims":
      return checkClaims(i.text).length ? "block" : "pass";
    case "lastmod": {
      const strip = i.strip_classes ?? [];
      const prev = contentHash(i.previous_body, strip);
      const got = resolveLastmod(i.body, prev, i.previous_lastmod, i.today, strip);
      return got.lastmod === i.expect_lastmod ? "pass" : "block";
    }
    default:
      throw new Error("unknown guard in fixtures: " + c.guard);
  }
}

export function run(log: (s: string) => void = console.log): boolean {
  const data = JSON.parse(readFileSync(FIXTURES, "utf8")) as { cases: Case[] };
  let passed = 0, failed = 0, current = "";
  for (const c of data.cases) {
    if (c.guard !== current) { current = c.guard; log("  " + current); }
    const got = verdict(c);
    const ok = got === c.expect;
    ok ? passed++ : failed++;
    log(`    [${ok ? "ok" : "FAIL"}] expected ${c.expect.padEnd(5)} got ${got.padEnd(5)}  ${c.name}`);
  }
  log(`  ${passed} passed, ${failed} failed`);
  return failed === 0;
}

if (process.argv[1] && process.argv[1].endsWith("selftest.js")) {
  process.exit(run() ? 0 : 2);
}

#!/usr/bin/env node
/**
 * contentgate MCP server.
 *
 * Exposes the guards as tools an assistant can call while it is writing or
 * translating a page, instead of after the page is already deployed.
 *
 * Every tool is pure: content in, verdict out. Nothing is written, nothing is
 * fetched, no network access, no filesystem access. The negative tests run once
 * at startup and the server refuses to start if they fail, because a checker
 * that cannot prove it still catches a known-bad input should not be answering
 * questions about your content.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  checkKeywords, checkTranslation, checkInternalLinks, checkClaims,
  contentHash, resolveLastmod, DEFAULT_PRIMARY_MIN_HITS,
} from "./guards.js";
import { run as runSelftest } from "./selftest.js";
import type { Scope } from "./html.js";

const scopeSchema = z.tuple([z.string(), z.string()]).optional()
  .describe('Element to look inside, as [tag, class], e.g. ["article","post"]. Omit to read the whole document.');
const excludeSchema = z.array(z.string()).default([])
  .describe("Classes whose subtree is ignored. Use this for site-wide call-to-action blocks, otherwise they satisfy the check on every page.");

const asScope = (s?: [string, string]): Scope => (s ? [s[0], s[1]] : null);
const text = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

const server = new McpServer({ name: "contentgate", version: "0.1.0" });

server.tool(
  "check_keywords",
  "Verify that target keywords actually appear in a rendered page. Every term tied at the highest search volume must appear at least `primary_min_hits` times; every other term at least once. Matching is literal and case-insensitive: whitespace is never normalised, because 'web hosting' and 'webhosting' are different terms with different search volumes.",
  {
    html: z.string().describe("Rendered HTML of the page."),
    keywords: z.record(z.number()).describe("Map of keyword to monthly search volume, taken from real tool data."),
    scope: scopeSchema,
    exclude_classes: excludeSchema,
    primary_min_hits: z.number().int().min(1).default(DEFAULT_PRIMARY_MIN_HITS),
  },
  async ({ html, keywords, scope, exclude_classes, primary_min_hits }) => {
    const r = checkKeywords(html, keywords, asScope(scope), exclude_classes, primary_min_hits);
    return text({
      verdict: r.problems.length ? "block" : "pass",
      covered_volume: r.covered, total_volume: r.total,
      problems: r.problems, rows: r.rows,
    });
  },
);

server.tool(
  "check_translation",
  "Compare a translation against its source document for structural drift: heading sequence, HTML tag sequence, table row count, internal link paths, price tokens, locale prefix on internal links, leftover source-script characters, introduced em dashes and emoji. This checks structure, not meaning: it cannot tell you a translation is good, only that it is no longer the same document.",
  {
    source: z.string().describe("The source-language markdown."),
    translation: z.string().describe("The translated markdown."),
    locale: z.string().describe('Locale code of the translation, e.g. "es". Internal links are expected to carry it as a prefix.'),
    forbid_source_script: z.boolean().default(true)
      .describe("Set false when the target legitimately shares the source script, e.g. Simplified Chinese from a Traditional Chinese source."),
    check_locale_prefix: z.boolean().default(true),
    require_front_matter: z.boolean().default(true)
      .describe("Require line 1 to be an H1 and line 2 to be a summary blockquote."),
  },
  async ({ source, translation, locale, forbid_source_script, check_locale_prefix, require_front_matter }) => {
    const problems = checkTranslation(source, translation, locale, {
      forbidSourceScript: forbid_source_script,
      checkLocalePrefix: check_locale_prefix,
      requireFrontMatter: require_front_matter,
    });
    return text({ verdict: problems.length ? "block" : "pass", problems });
  },
);

server.tool(
  "check_internal_links",
  "Check that a content page links to at least one commercial page from its body, and optionally that it states a concrete figure. Links inside excluded boilerplate do not count, because a site-wide call-to-action block would otherwise satisfy this on every page and the check would guard nothing.",
  {
    html: z.string(),
    money_paths: z.array(z.string()).describe('Path prefixes that count as commercial, e.g. ["/pricing/","/services/"].'),
    scope: scopeSchema,
    exclude_classes: excludeSchema,
    require_figure: z.boolean().default(false)
      .describe('Also require a concrete price or quantity in the body. "Contact us for a quote" is not an offer.'),
    extra_evidence: z.array(z.string()).default([])
      .describe("Literal strings that satisfy require_figure on their own, such as named product modules."),
  },
  async ({ html, money_paths, scope, exclude_classes, require_figure, extra_evidence }) => {
    const r = checkInternalLinks(html, money_paths, asScope(scope), exclude_classes, require_figure, extra_evidence);
    return text({ verdict: r.problems.length ? "block" : "pass", problems: r.problems, commercial_links: r.found });
  },
);

server.tool(
  "check_claims",
  "Scan copy for affirmative performance claims of the kind that get finance, gambling and health advertising rejected: guaranteed profit, stated win rates, promised returns. Sentences that exist to disclaim or prohibit those phrases are not flagged.",
  { text: z.string().describe("Plain text or HTML. HTML tags are ignored.") },
  async ({ text: input }) => {
    const hits = checkClaims(input);
    return text({ verdict: hits.length ? "block" : "pass", hits });
  },
);

server.tool(
  "sitemap_lastmod",
  "Decide a sitemap lastmod date honestly. Hash the meaningful content of a page, compare it against the stored hash, and move the date only when the content genuinely changed. Stamping today's date on every URL every build teaches crawlers that the field carries no information.",
  {
    body: z.string().describe("Current HTML of the page."),
    previous_hash: z.string().nullable().default(null).describe("Stored hash from the last run, or null for a page seen for the first time."),
    previous_lastmod: z.string().nullable().default(null).describe("Stored lastmod, ISO date."),
    today: z.string().describe("Today's date, ISO format."),
    strip_classes: z.array(z.string()).default([])
      .describe("Classes to remove before hashing: visitor counters, build ids, anything that changes on its own."),
    strip_patterns: z.array(z.string()).default([]).describe("Regular expressions to remove before hashing."),
  },
  async ({ body, previous_hash, previous_lastmod, today, strip_classes, strip_patterns }) => {
    const r = resolveLastmod(body, previous_hash, previous_lastmod, today, strip_classes, strip_patterns);
    return text(r);
  },
);

server.tool(
  "content_hash",
  "Hash the meaningful content of a page, with volatile blocks and scripts removed. Use it to tell a real edit from a rebuild.",
  {
    body: z.string(),
    strip_classes: z.array(z.string()).default([]),
    strip_patterns: z.array(z.string()).default([]),
  },
  async ({ body, strip_classes, strip_patterns }) => text({ hash: contentHash(body, strip_classes, strip_patterns) }),
);

async function main() {
  const lines: string[] = [];
  if (!runSelftest((s) => lines.push(s))) {
    console.error("contentgate: negative tests failed, refusing to start.");
    console.error(lines.join("\n"));
    process.exit(2);
  }
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("contentgate: fatal", err);
  process.exit(1);
});

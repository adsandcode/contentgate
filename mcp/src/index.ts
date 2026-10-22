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
import {
  auditPage, checkDuplicateSentences, CHECKS,
  DEFAULT_MIN_CHARS, DEFAULT_REQUIRE_TYPES, DEFAULT_PHRASES, DEFAULT_MAX_SHARE,
} from "./audit.js";
import { run as runSelftest } from "./selftest.js";
import type { Scope } from "./html.js";

export const VERSION = "0.2.0";

const scopeSchema = z.tuple([z.string(), z.string()]).optional()
  .describe('Element to look inside, as [tag, class], e.g. ["article","post"]. Omit to read the whole document.');
const excludeSchema = z.array(z.string()).default([])
  .describe("Classes whose subtree is ignored. Use this for site-wide call-to-action blocks, otherwise they satisfy the check on every page.");

const asScope = (s?: [string, string]): Scope => (s ? [s[0], s[1]] : null);
const text = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

const server = new McpServer({ name: "contentgate", version: VERSION });

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
  "Scan copy for affirmative performance claims of the kind that get finance, health and other regulated advertising rejected: guaranteed profit, stated win rates, promised returns. Sentences that exist to disclaim or prohibit those phrases are not flagged.",
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

const fail = (message: string) => ({
  isError: true,
  content: [{ type: "text" as const, text: `configuration problem: ${message}` }],
});

server.tool(
  "audit_page",
  "Page-level SEO/GEO audit of one rendered HTML page, before it ships. Checks: " +
  "visible_text (characters readable with JavaScript off; Google renders JavaScript, but many AI crawlers read only the HTML the server sent, so an article injected by a script is invisible to them); " +
  "structured_data (every JSON-LD block parses, required @type values are present, dateModified exists; a ProfilePage is not required to be an Article); " +
  "outbound_links (external links without rel nofollow, sponsored or ugc, with hosts resolved the way a browser resolves them, so backslash and extra-slash tricks are caught; list editorially cited sites in cite_ok); " +
  "images (<img> without alt or width); " +
  "favicon (home page only: an icon <link> in <head>, in a format Google Search lists); " +
  "stock_phrases (an editorial style list of filler phrases; not a detector of machine-written text). " +
  "Returns a verdict per check. Pure: nothing is fetched or written.",
  {
    html: z.string().describe("Rendered HTML of the page, as the server sends it."),
    url: z.string().describe("The page's public URL. Decides which links are external and whether this is the home page."),
    checks: z.array(z.enum(CHECKS)).optional().describe("Run only these checks. Default: all six."),
    min_chars: z.number().int().min(0).default(DEFAULT_MIN_CHARS)
      .describe("visible_text: minimum characters readable with JavaScript off. 1200 is a house rule, not a search-engine number."),
    require_types: z.array(z.string()).default(DEFAULT_REQUIRE_TYPES)
      .describe("structured_data: @type values that must be present."),
    require_date_modified: z.boolean().default(true).describe("structured_data: require a dateModified."),
    cite_ok: z.array(z.string()).default([])
      .describe('outbound_links: domains you cite editorially, exempt from rel, matched with their subdomains, e.g. ["gov.uk"]. Registries anyone can register under (co.uk, github.io, pages.dev...) are refused. Never list paid or affiliate partners here.'),
    stock_phrases: z.array(z.string()).optional()
      .describe("stock_phrases: phrases to flag, matched case-insensitively. Default: a Traditional Chinese list; supply your own for other languages."),
  },
  async ({ html, url, checks, min_chars, require_types, require_date_modified, cite_ok, stock_phrases }) => {
    try {
      const results = auditPage(html, url, {
        checks, minChars: min_chars, requireTypes: require_types,
        requireDateModified: require_date_modified, citeOk: cite_ok,
        phrases: stock_phrases ?? DEFAULT_PHRASES,
      });
      const failed = Object.entries(results).filter(([, r]) => r.verdict === "block").map(([n]) => n);
      return text({ verdict: failed.length ? "block" : "pass", failed, checks: results });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

server.tool(
  "compare_pages",
  "Measure how many sentences two pages share word for word, using the text a crawler sees with JavaScript off (navigation and footers excluded). Sentences split on 。！？ and on . ! ? followed by whitespace; sentences under ten characters are ignored. The share is measured in characters, in both directions, and the larger figure decides, because a short page copied into a long one is a small share of the long page and all of the short one.",
  {
    html_a: z.string().describe("Rendered HTML of the first page."),
    html_b: z.string().describe("Rendered HTML of the second page."),
    max_share: z.number().min(0).max(1).default(DEFAULT_MAX_SHARE)
      .describe("Largest acceptable shared share, 0 to 1."),
  },
  async ({ html_a, html_b, max_share }) => {
    const r = checkDuplicateSentences(html_a, html_b, max_share);
    return text({
      verdict: r.problems.length ? "block" : "pass",
      share_a_in_b: r.a_in_b, share_b_in_a: r.b_in_a, max_share,
      problems: r.problems, shared_sentences: r.shared,
    });
  },
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

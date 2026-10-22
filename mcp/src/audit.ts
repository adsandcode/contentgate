/**
 * Page-level SEO/GEO checks. Each mirrors a module in src/contentgate/guards/
 * and is held to the same cases in fixtures/cases.json; the Python docstrings
 * carry the reasoning, this file carries the port.
 *
 * Lengths are counted in code points ([...s].length), as Python's len() does,
 * not in UTF-16 units.
 */

import { WS, WS_CLASS, stripChars, unescape, scanTags, firstWins } from "./html.js";
import { pageParts, resolveHost, under } from "./urls.js";

export interface CheckResult {
  problems: string[];
  [detail: string]: unknown;
}

const cpLength = (s: string) => [...s].length;

/* ---------------- visible_text ---------------- */

export const DEFAULT_MIN_CHARS = 1200;

// Case-insensitive on ASCII only, matching Python's re.I | re.A.
const SCRIPT_STYLE = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
const MAIN = /<main[^>]*>([\s\S]*?)<\/main>/i;
const NAV_FOOTER = /<(nav|footer)[^>]*>[\s\S]*?<\/\1>/gi;
const WBR = new RegExp("<wbr[" + WS_CLASS + "]*/?>", "gi");
const TAG = /<[^>]+>/g;
const WS_RUN = new RegExp("[" + WS_CLASS + "]+", "g");

/** Visible text of `html` with JavaScript off, whitespace collapsed. */
export function crawlerText(html: string): string {
  let t = html.replace(SCRIPT_STYLE, " ");
  const m = MAIN.exec(t);
  if (m) t = m[1];
  t = t.replace(NAV_FOOTER, " ").replace(WBR, "").replace(TAG, " ");
  t = unescape(t).split("\u200b").join("");
  return stripChars(t.replace(WS_RUN, " "), " ");
}

export function checkVisibleText(html: string, minChars = DEFAULT_MIN_CHARS): CheckResult {
  const chars = cpLength(crawlerText(html));
  const problems = chars < minChars
    ? [`only ${chars} character(s) of text are readable with JavaScript off; needs at least ${minChars}`]
    : [];
  return { problems, chars };
}

/* ---------------- structured_data ---------------- */

export const DEFAULT_REQUIRE_TYPES = ["Article", "BreadcrumbList", "Organization"];

const LD_BLOCK = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
const NESTED = ["author", "publisher", "creator"];

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const isObject = (v: unknown): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const asList = (v: Json | undefined): Array<Json | undefined> => (Array.isArray(v) ? v : [v]);

function addTypes(out: string[], value: Json | undefined) {
  for (const t of asList(value)) if (typeof t === "string" && t) out.push(t);
}

function node(out: string[], item: Record<string, Json>) {
  addTypes(out, item["@type"]);
  for (const key of NESTED) {
    for (const x of asList(item[key])) if (isObject(x)) addTypes(out, x["@type"]);
  }
}

function dates(value: Json): string[] {
  const found: string[] = [];
  const stack: Json[] = [value];
  while (stack.length) {
    const v = stack.pop()!;
    if (isObject(v)) {
      const dm = v["dateModified"];
      if (typeof dm === "string" && dm) found.push(dm);
      stack.push(...Object.values(v).reverse());
    } else if (Array.isArray(v)) {
      stack.push(...v.slice().reverse());
    }
  }
  return found;
}

export function parseStructuredData(html: string): { types: string[]; broken: string[]; dates: string[] } {
  const types: string[] = [], broken: string[] = [], found: string[] = [];
  for (const m of html.matchAll(LD_BLOCK)) {
    let data: Json;
    try {
      // JSON.parse already refuses NaN and Infinity; Python is told to.
      data = JSON.parse(stripChars(m[1]));
    } catch (err) {
      broken.push(String((err as Error).message).slice(0, 80));
      continue;
    }
    found.push(...dates(data));
    for (const item of asList(data)) {
      if (!isObject(item)) continue;
      node(types, item);
      for (const g of asList(item["@graph"])) if (isObject(g)) node(types, g);
    }
  }
  return { types, broken, dates: found };
}

export function checkStructuredData(
  html: string, requireTypes: string[] = DEFAULT_REQUIRE_TYPES, requireDateModified = true,
): CheckResult {
  const { types, broken, dates: found } = parseStructuredData(html);
  const present = new Set(types);
  let wanted = [...requireTypes];
  // ProfilePage covers author pages, which are not articles.
  if (present.has("ProfilePage")) wanted = wanted.filter((t) => t !== "Article");
  const missing = wanted.filter((t) => !present.has(t));
  const sorted = [...present].sort();

  const problems: string[] = [];
  if (broken.length) problems.push(`${broken.length} JSON-LD block(s) do not parse: ${broken.join("; ")}`);
  if (missing.length)
    problems.push(`structured data lacks ${missing.join(", ")} (found: ${sorted.join(", ") || "none"})`);
  if (requireDateModified && !found.length) problems.push("no dateModified in the structured data");
  return { problems, types: sorted, broken_blocks: broken.length, date_modified: found };
}

/* ---------------- outbound_links ---------------- */

export const QUALIFIERS = ["nofollow", "sponsored", "ugc"];
export const TOO_BROAD = new Set([
  "com.tw", "net.tw", "org.tw", "idv.tw", "game.tw", "club.tw", "ebiz.tw",
  "pages.dev", "workers.dev", "github.io", "vercel.app", "netlify.app", "web.app",
  "firebaseapp.com", "blogspot.com", "wordpress.com", "wixsite.com", "herokuapp.com",
  "appspot.com", "azurewebsites.net", "cloudfront.net", "amazonaws.com",
]);
const CC_SECOND_LEVEL = /^(?:com|net|org|co|idv)\.[a-z]{2}$/;
const REL_SPLIT = new RegExp("[" + WS_CLASS + ",]+");

const isPublicSuffixLike = (d: string) => TOO_BROAD.has(d) || CC_SECOND_LEVEL.test(d);
export const tooBroad = (d: string) => !d.includes(".") || isPublicSuffixLike(d);

/** 'https://www.Docs.Example.org/x' -> 'docs.example.org'; '*.a.b' -> 'a.b'. */
export function normaliseDomain(value: string): string {
  const bare = stripChars(value).toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split("/")[0];
  return bare.replace(/^(?:\*?\.|www\.)/, "");
}

export function validateCiteOk(entries: string[]): { domains: string[]; problems: string[] } {
  const domains: string[] = [], problems: string[] = [];
  for (const raw of entries) {
    const d = normaliseDomain(raw);
    if (!d) continue;
    if (tooBroad(d)) {
      problems.push(`cite_ok entry '${raw}' is too broad: it would exempt every site registered under it; list the specific site instead`);
      continue;
    }
    domains.push(d);
  }
  return { domains, problems };
}

export const relTokens = (value: string) => value.toLowerCase().split(REL_SPLIT).filter(Boolean);

/** [unqualified hosts, cited hosts], one entry per link. Throws on bad configuration. */
export function scanOutbound(html: string, url: string, citeOk: string[] = []): [string[], string[]] {
  const { domains, problems } = validateCiteOk(citeOk);
  if (problems.length) throw new Error(problems.join("; "));
  const [scheme, host] = pageParts(url);
  const site = host.startsWith("www.") ? host.slice(4) : host;
  if (isPublicSuffixLike(site))
    throw new Error(`page host '${site}' is a public suffix; every site under it would count as internal`);
  const unqualified: string[] = [], cited: string[] = [];
  for (const t of scanTags(html)) {
    if (t.kind !== "start" || t.tag !== "a") continue;
    const a = firstWins(t.attrs);
    const href = a["href"];
    if (!href) continue;
    const h = resolveHost(href, scheme, host);
    if (!h || under(h, site)) continue;
    if (relTokens(a["rel"] ?? "").some((r) => QUALIFIERS.includes(r))) continue;
    (domains.some((d) => under(h, d)) ? cited : unqualified).push(h);
  }
  return [unqualified, cited];
}

/** 'a.example x2, b.example', most frequent first, ties in order of appearance. */
export function summary(hosts: string[], limit = 5): string {
  const counts = new Map<string, number>();
  for (const h of hosts) counts.set(h, (counts.get(h) ?? 0) + 1);
  return [...counts.entries()]
    .map(([h, n], order) => ({ h, n, order }))
    .sort((a, b) => b.n - a.n || a.order - b.order)
    .slice(0, limit)
    .map(({ h, n }) => (n === 1 ? h : `${h} x${n}`))
    .join(", ");
}

export function checkOutboundLinks(html: string, url: string, citeOk: string[] = []): CheckResult {
  const [unqualified, cited] = scanOutbound(html, url, citeOk);
  const problems = unqualified.length
    ? [`${unqualified.length} external link(s) without rel nofollow, sponsored or ugc: ${summary(unqualified)}`]
    : [];
  return { problems, unqualified, cited };
}

/* ---------------- images ---------------- */

export function checkImages(html: string): CheckResult {
  let total = 0;
  const lacking: Array<{ src: string; missing: string[] }> = [];
  for (const t of scanTags(html)) {
    if (t.kind !== "start" || t.tag !== "img") continue;
    total += 1;
    const a = firstWins(t.attrs);
    const missing = ["alt", "width"].filter((x) => !(x in a));
    if (missing.length) lacking.push({ src: a["src"] || "(no src)", missing });
  }
  const problems = lacking.length
    ? [`${lacking.length} of ${total} image(s) lack alt or width: ${
      lacking.slice(0, 5).map((x) => `${x.src} (${x.missing.join(", ")})`).join("; ")}`]
    : [];
  return { problems, images: total, lacking };
}

/* ---------------- favicon ---------------- */

export const ICON_RELS = ["icon", "apple-touch-icon", "apple-touch-icon-precomposed"];
// developers.google.com/search/docs/appearance/favicon-in-search lists
// BMP, GIF, ICO, PNG, JPEG, PPM and TIFF.
const SUPPORTED_EXT = /\.(?:ico|png|gif|jpe?g|bmp|ppm|tiff?)$/i;
const WS_SPLIT = new RegExp("[" + WS_CLASS + "]+");

export const isHomePage = (url: string) => ["", "/"].includes(pageParts(url)[2]);

export function iconsInHead(html: string): string[] {
  const found: string[] = [];
  for (const t of scanTags(html)) {
    if ((t.kind === "end" && t.tag === "head") || (t.kind === "start" && t.tag === "body")) break;
    if (t.kind !== "start" || t.tag !== "link") continue;
    const a = firstWins(t.attrs);
    const rels = (a["rel"] ?? "").toLowerCase().split(WS_SPLIT).filter(Boolean);
    const href = stripChars(a["href"] ?? "");
    if (href && rels.some((r) => ICON_RELS.includes(r))) found.push(href);
  }
  return found;
}

export const supportedIcon = (href: string) => SUPPORTED_EXT.test(href.split(/[?#]/)[0]);

export function checkFavicon(html: string, url: string): CheckResult {
  if (!isHomePage(url)) return { problems: [], home_page: false, icons: [] };
  const icons = iconsInHead(html);
  const problems: string[] = [];
  if (!icons.length)
    problems.push('the home page declares no favicon (<link rel="icon"> in <head>); Google Search reads it from the home page');
  else if (!icons.some(supportedIcon))
    problems.push(`every declared favicon is in a format Google Search does not list (${icons.join(", ")}); use ICO, PNG, GIF, JPEG, BMP, PPM or TIFF`);
  return { problems, home_page: true, icons };
}

/* ---------------- stock_phrases ---------------- */

export const DEFAULT_PHRASES = [
  "總的來說", "值得注意的是", "無論如何", "綜上所述", "首先，", "其次，",
  "最後，", "此外，", "然而，", "因此，", "總而言之", "在這個快節奏",
];

function count(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

export function checkStockPhrases(html: string, phrases: string[] = DEFAULT_PHRASES): CheckResult {
  const text = crawlerText(html).toLowerCase();
  const found: Record<string, number> = {};
  for (const p of phrases) {
    if (!p) continue;
    const n = count(text, p.toLowerCase());
    if (n) found[p] = n;
  }
  const entries = Object.entries(found);
  const problems = entries.length
    ? [`${entries.length} stock phrase(s) found: ${entries.map(([p, n]) => `'${p}' (${n})`).join(", ")}`]
    : [];
  return { problems, found };
}

/* ---------------- duplicate_sentences ---------------- */

export const DEFAULT_MAX_SHARE = 0.15;
export const MIN_SENTENCE_CHARS = 10;
const SENTENCE_SPLIT = new RegExp("[。！？]|[.!?](?![^" + WS_CLASS + "])");

/** Unique sentences of at least MIN_SENTENCE_CHARS code points, in order. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(SENTENCE_SPLIT)) {
    const s = stripChars(part, WS);
    if (cpLength(s) >= MIN_SENTENCE_CHARS && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

export function share(a: string[], b: string[]): number {
  if (!a.length) return 0;
  const inB = new Set(b);
  let shared = 0, total = 0;
  for (const s of a) {
    const n = cpLength(s);
    total += n;
    if (inB.has(s)) shared += n;
  }
  return shared / total;
}

const percent = (x: number) => Math.floor(x * 100 + 0.5);

export function checkDuplicateSentences(htmlA: string, htmlB: string, maxShare = DEFAULT_MAX_SHARE): CheckResult {
  const a = sentences(crawlerText(htmlA));
  const b = sentences(crawlerText(htmlB));
  const aInB = share(a, b), bInA = share(b, a);
  const inB = new Set(b);
  const shared = a.filter((s) => inB.has(s)).slice(0, 5).map((s) => [...s].slice(0, 80).join(""));
  const problems = Math.max(aInB, bInA) > maxShare
    ? [`pages share sentences verbatim: ${percent(aInB)}% of A appears in B, ${percent(bInA)}% of B appears in A; limit ${percent(maxShare)}%`]
    : [];
  return { problems, a_in_b: aInB, b_in_a: bInA, shared };
}

/* ---------------- audit_page ---------------- */

export const CHECKS = ["visible_text", "structured_data", "outbound_links", "images", "favicon", "stock_phrases"] as const;
export type CheckName = typeof CHECKS[number];

export interface AuditOptions {
  checks?: readonly string[];
  minChars?: number;
  requireTypes?: string[];
  requireDateModified?: boolean;
  citeOk?: string[];
  phrases?: string[];
}

/** Run the requested checks in CHECKS order. Throws on unknown checks or bad configuration. */
export function auditPage(html: string, url: string, opts: AuditOptions = {}): Record<string, CheckResult & { verdict: string }> {
  const checks = opts.checks ?? CHECKS;
  const unknown = checks.filter((c) => !(CHECKS as readonly string[]).includes(c));
  if (unknown.length) throw new Error(`unknown check(s): ${unknown.join(", ")}; known: ${CHECKS.join(", ")}`);
  const run: Record<CheckName, () => CheckResult> = {
    visible_text: () => checkVisibleText(html, opts.minChars ?? DEFAULT_MIN_CHARS),
    structured_data: () => checkStructuredData(html, opts.requireTypes ?? DEFAULT_REQUIRE_TYPES, opts.requireDateModified ?? true),
    outbound_links: () => checkOutboundLinks(html, url, opts.citeOk ?? []),
    images: () => checkImages(html),
    favicon: () => checkFavicon(html, url),
    stock_phrases: () => checkStockPhrases(html, opts.phrases ?? DEFAULT_PHRASES),
  };
  const results: Record<string, CheckResult & { verdict: string }> = {};
  for (const name of CHECKS) {
    if (!checks.includes(name)) continue;
    const r = run[name]();
    results[name] = { verdict: r.problems.length ? "block" : "pass", ...r };
  }
  return results;
}

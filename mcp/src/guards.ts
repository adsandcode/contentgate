/**
 * The guards. Behaviour is fixed by ../../fixtures/cases.json, which the Python
 * implementation runs too. If these two ever disagree on a case, CI fails and
 * one of them is wrong.
 */

import { createHash } from "node:crypto";
import { visibleText, links as extractLinks, stripped, stripChars, WS, WS_CLASS, type Scope } from "./html.js";
import { resolve, under } from "./urls.js";
import { normaliseDomain, isPublicSuffixLike } from "./audit.js";

export const DEFAULT_PRIMARY_MIN_HITS = 3;

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0, i = 0;
  for (;;) {
    const at = haystack.indexOf(needle, i);
    if (at === -1) return n;
    n += 1;
    i = at + needle.length;
  }
}

export interface KeywordRow {
  keyword: string; volume: number; hits: number; needed: number; ok: boolean;
}

export function checkKeywords(
  html: string,
  keywords: Record<string, number>,
  scope: Scope = null,
  excludeClasses: string[] = [],
  primaryMinHits = DEFAULT_PRIMARY_MIN_HITS,
): { problems: string[]; rows: KeywordRow[]; covered: number; total: number } {
  const entries = Object.entries(keywords);
  if (entries.length === 0) return { problems: [], rows: [], covered: 0, total: 0 };

  const body = visibleText(html, scope, excludeClasses).toLowerCase();
  // Every term tied at the top volume is primary; see the Python docstring.
  const top = Math.max(...entries.map(([, v]) => v));

  const rows: KeywordRow[] = entries
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([keyword, volume]) => {
      const hits = countOccurrences(body, keyword.toLowerCase());
      const needed = volume === top ? primaryMinHits : 1;
      return { keyword, volume, hits, needed, ok: hits >= needed };
    });

  const problems = rows.filter((r) => !r.ok).map(
    (r) => `missing keyword '${r.keyword}' (volume ${r.volume}): found ${r.hits} time(s), needs ${r.needed}`);
  return {
    problems, rows,
    covered: rows.filter((r) => r.ok).reduce((s, r) => s + r.volume, 0),
    total: rows.reduce((s, r) => s + r.volume, 0),
  };
}

const PRICE = /(?<![A-Za-z])\$\d[\d,]*(?<![,.])(?:\s?USDT)?/g;
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿⬀-⯿]/gu;
const CJK = /[一-鿿㐀-䶿！-～]/g;
const MD_LINK = /\]\((\/[^)]*)\)/g;

function matchAll(text: string, re: RegExp): string[] {
  return [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))]
    .map((m) => m[0]);
}

function fingerprint(text: string, locale?: string) {
  let linkPaths = [...text.matchAll(MD_LINK)].map((m) => m[1]);
  if (locale) {
    const re = new RegExp("^/" + locale.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=/)");
    linkPaths = linkPaths.map((u) => u.replace(re, "") || "/");
  }
  return {
    headings: [...text.matchAll(/^(#{1,6})\s/gm)].map((m) => m[1]),
    tags: [...text.matchAll(/<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]),
    tableRows: (text.match(/^\s*\|/gm) ?? []).length,
    links: linkPaths.slice().sort(),
    prices: matchAll(text, PRICE).sort(),
  };
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface TranslationOptions {
  requireFrontMatter?: boolean;
  forbidSourceScript?: boolean;
  checkLocalePrefix?: boolean;
}

export function checkTranslation(
  source: string, translation: string, locale: string, opts: TranslationOptions = {},
): string[] {
  const {
    requireFrontMatter = true, forbidSourceScript = true, checkLocalePrefix = true,
  } = opts;
  const problems: string[] = [];
  const lines = translation.split("\n");

  if (requireFrontMatter) {
    if (!lines[0]?.startsWith("# ")) problems.push("line 1 is not an H1 heading");
    if (!lines[1]?.startsWith("> ")) problems.push("line 2 is not a summary blockquote");
  }

  const a = fingerprint(source);
  const b = fingerprint(translation, locale);

  if (!eq(a.headings, b.headings))
    problems.push(`heading sequence differs (source ${a.headings.length}, translation ${b.headings.length})`);
  if (!eq(a.tags, b.tags))
    problems.push(`HTML tag sequence differs (source ${a.tags.length}, translation ${b.tags.length})`);
  if (a.tableRows !== b.tableRows)
    problems.push(`table row count differs (source ${a.tableRows}, translation ${b.tableRows})`);
  if (!eq(a.links, b.links)) {
    const missing = a.links.filter((x) => !b.links.includes(x)).slice(0, 3);
    const extra = b.links.filter((x) => !a.links.includes(x)).slice(0, 3);
    problems.push(`internal links differ; missing ${JSON.stringify(missing)} unexpected ${JSON.stringify(extra)}`);
  }
  if (!eq(a.prices, b.prices))
    problems.push(`price tokens differ: source ${JSON.stringify(a.prices)} translation ${JSON.stringify(b.prices)}`);

  if (checkLocalePrefix && locale) {
    const raw = [...translation.matchAll(MD_LINK)].map((m) => m[1]);
    const bare = raw.filter((u) => !u.startsWith(`/${locale}/`));
    const doubled = raw.filter((u) => u.startsWith(`/${locale}/${locale}/`));
    if (bare.length)
      problems.push(`${bare.length} internal link(s) missing the /${locale} prefix: ${JSON.stringify(bare.slice(0, 3))}`);
    if (doubled.length)
      problems.push(`${doubled.length} internal link(s) carry the locale prefix twice: ${JSON.stringify(doubled.slice(0, 3))}`);
  }

  if (forbidSourceScript) {
    const left = matchAll(translation, CJK);
    if (left.length) problems.push(`${left.length} untranslated source-script character(s) remain`);
  }

  const emSource = (source.match(/—/g) ?? []).length;
  const emTranslation = (translation.match(/—/g) ?? []).length;
  if (emTranslation > emSource)
    problems.push(`em dashes introduced (source ${emSource}, translation ${emTranslation})`);

  const emoji = matchAll(translation, EMOJI);
  if (emoji.length) problems.push(`${emoji.length} emoji present`);

  return problems;
}

const FIGURE = /(?<![A-Za-z])[$€£¥]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*\s?(?:USD|USDT|EUR|GBP|TWD|JPY)\b/i;

/** Normalised site_hosts; throws for an entry anyone can register under. */
export function siteDomains(siteHosts: string[]): string[] {
  const out: string[] = [];
  for (const raw of siteHosts) {
    const d = normaliseDomain(raw);
    if (!d) continue;
    if (isPublicSuffixLike(d))
      throw new Error(`site_hosts entry '${raw}' is a public suffix; every site under it would count as yours`);
    out.push(d);
  }
  return out;
}

/** The path of `href` if it points into the site, else null. See internal_links.py. */
export function ownPath(href: string, domains: string[]): string | null {
  const [host, path, absolute] = resolve(href, "https", "");
  if (absolute && !(host && domains.some((d) => under(host, d)))) return null;
  return path;
}

export function checkInternalLinks(
  html: string, moneyPaths: string[], scope: Scope = null, excludeClasses: string[] = [],
  requireFigure = false, extraEvidence: string[] = [], siteHosts: string[] = [],
): { problems: string[]; found: string[] } {
  const domains = siteDomains(siteHosts);
  const problems: string[] = [];
  const found = extractLinks(html, scope, excludeClasses).filter((h) => {
    const path = ownPath(h, domains);
    return path !== null && moneyPaths.some((p) => path.startsWith(p) || path.includes("/" + p.replace(/^\//, "")));
  });
  if (found.length === 0)
    problems.push(`no link to a commercial page in the body; looked for ${JSON.stringify(moneyPaths)}`);

  if (requireFigure) {
    const body = visibleText(html, scope, excludeClasses);
    const hasNamed = extraEvidence.some((e) => e && body.includes(e));
    if (!FIGURE.test(body) && !hasNamed)
      problems.push("no concrete figure or named product capability in the body");
  }
  return { problems, found };
}

// Claims: the same pattern strings as src/contentgate/guards/claims.py, whose
// docstring explains when a negation governs a claim. Explicit classes instead
// of \s, \d and \b; case-insensitive on ASCII only (no "u" flag), as in Python.
const S = "[" + WS_CLASS + "]";
const D = "[0-9０-９]";
const L = "(?<![A-Za-z])";
const R = "(?![A-Za-z])";
const NEG_CONTRACTION = "(?:do|does|did|wo|is|are|was|were|should|would)n['’]t";

const CLAIM_SRC =
  "guaranteed" + S + "+(?:profit|win|return|income)|guarantees?" + S + "+profit|"
  + "sure" + S + "+win|risk(?:-|" + S + ")?free" + S + "+(?:profit|return)|"
  + "can['’]?t" + S + "+lose|"
  + "保證獲利|保證賺|穩賺不賠|穩賺|必勝|包贏|穩定獲利|穩定盈利";
const PERF_SRC =
  "win" + S + "*rate" + S + "*" + D + "|hit" + S + "*rate" + S + "*" + D + "|"
  + "roi" + S + "*" + D + "+" + S + "*x|returns?" + S + "+of" + S + "+" + D + "+" + S + "*[%％]|"
  + D + "+" + S + "*[%％]" + S + "+win" + S + "+rate|"
  + "勝率" + S + "*" + D + "|命中率" + S + "*" + D + "|報酬率" + S + "*" + D + "|"
  + "獲利" + S + "*" + D + "+" + S + "*(?:[%％]|倍|萬)";
const GOVERN_SRC =
  L + "(?:not|no|never|without|cannot|nor|avoids?|rejects?|blocks?|bans?|prohibits?|"
  + "forbids?|disclaims?|rather" + S + "+than|instead" + S + "+of|free" + S + "+of)" + R + "|"
  + L + NEG_CONTRACTION + R + "|"
  + "不|沒有|禁止|嚴禁|避免|排除|拒絕|攔下|擋下";
const NOT_GOVERNING_SRC =
  "(?:not|never|" + NEG_CONTRACTION + ")" + S + "+"
  + "(?:only|just|before|miss|regret|wait|hesitate|worry|forget|delay|stop|lose)" + R + "|"
  + "no" + S + "+(?:doubt|matter|wonder|risk|worries|need)" + R + "|"
  + "不(?:斷|少|錯|僅|只|但|止|管|論|用|同|久|怕|必)|沒有(?:風險|問題|比)";
const MENTION_SRC =
  "^" + S + "*(?:claims?|wording|language|phrases?|statements?|promises?|"
  + "等字眼|等字樣|等說法|等用語|字眼|字樣|說法|用語|宣稱|之類)";
const PROHIBIT_SRC =
  L + "(?:banned|prohibited|forbidden|not" + S + "+allowed|illegal|rejected|blocked)" + R + "|"
  + "禁止|不得|不允許|不可|違法|違規|嚴禁|擋下|攔下";
const LIST_GAP = new RegExp("^(?:" + S + "|[、,，/]|" + L + "(?:or|and)" + R + "|或|和|及|與)*$", "i");
const CLAUSE_BREAK = /[，,：:]/;
const SENTENCE_SPLIT = /[。；！？\n.!?;]/;
const LATIN_WORD = /[A-Za-z0-9'’]+/g;
const HAN = /[一-鿿]/g;
const MAX_LATIN_WORDS_BETWEEN = 3;
const MAX_HAN_BETWEEN = 2;

type Span = [number, number, "claim" | "performance"];

const spans = (s: string, src: string, kind: Span[2]): Span[] =>
  [...s.matchAll(new RegExp(src, "gi"))].map((m) => [m.index!, m.index! + m[0].length, kind]);

function groupsOf(s: string, matches: Span[]): Span[][] {
  const groups: Span[][] = [];
  for (const m of matches) {
    if (groups.length) {
      const lastEnd = Math.max(...groups[groups.length - 1].map((x) => x[1]));
      const gap = m[0] > lastEnd ? s.slice(lastEnd, m[0]) : "";
      if (LIST_GAP.test(gap)) { groups[groups.length - 1].push(m); continue; }
    }
    groups.push([m]);
  }
  return groups;
}

function governed(s: string, start: number, matches: Span[]): boolean {
  const notGoverning = new RegExp(NOT_GOVERNING_SRC, "iy");
  for (const g of s.matchAll(new RegExp(GOVERN_SRC, "gi"))) {
    const gs = g.index!, ge = gs + g[0].length;
    if (ge > start) break;
    if (matches.some((m) => gs < m[1] && ge > m[0])) continue; // the 不 inside 穩賺不賠
    notGoverning.lastIndex = gs;
    if (notGoverning.test(s)) continue;
    const between = s.slice(ge, start);
    if (CLAUSE_BREAK.test(between)) continue;
    if ((between.match(LATIN_WORD) ?? []).length <= MAX_LATIN_WORDS_BETWEEN
        && (between.match(HAN) ?? []).length <= MAX_HAN_BETWEEN) return true;
  }
  return false;
}

function namedNotAsserted(s: string, end: number): boolean {
  const rest = s.slice(end);
  const m = new RegExp(MENTION_SRC, "i").exec(rest);
  if (!m) return false;
  const clause = rest.slice(m[0].length).split(CLAUSE_BREAK)[0];
  return new RegExp(PROHIBIT_SRC, "i").test(clause);
}

function assertedKinds(s: string): Set<string> {
  const matches = [...spans(s, CLAIM_SRC, "claim"), ...spans(s, PERF_SRC, "performance")]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
  const kinds = new Set<string>();
  for (const group of groupsOf(s, matches)) {
    const end = Math.max(...group.map((m) => m[1]));
    if (governed(s, group[0][0], matches) || namedNotAsserted(s, end)) continue;
    for (const m of group) kinds.add(m[2]);
  }
  return kinds;
}

export function checkClaims(text: string): Array<{ kind: string; sentence: string }> {
  const hits: Array<{ kind: string; sentence: string }> = [];
  for (const raw of text.split(SENTENCE_SPLIT)) {
    const s = stripChars(raw, WS);
    if (!s) continue;
    const kinds = assertedKinds(s);
    const sentence = [...s].slice(0, 120).join("");
    for (const kind of ["claim", "performance"]) if (kinds.has(kind)) hits.push({ kind, sentence });
  }
  return hits;
}

export function contentHash(body: string, stripClasses: string[] = [], stripPatterns: string[] = []): string {
  let b = body;
  for (const p of stripPatterns) b = b.replace(new RegExp(p, "gs"), "");
  return createHash("sha256").update(stripped(b, stripClasses), "utf8").digest("hex");
}

export function resolveLastmod(
  body: string, previousHash: string | null, previousLastmod: string | null, today: string,
  stripClasses: string[] = [], stripPatterns: string[] = [],
): { lastmod: string; changed: boolean; hash: string } {
  const hash = contentHash(body, stripClasses, stripPatterns);
  if (previousHash === null || previousHash === undefined)
    return { lastmod: previousLastmod ?? today, changed: true, hash };
  if (hash === previousHash)
    return { lastmod: previousLastmod ?? today, changed: false, hash };
  return { lastmod: today, changed: true, hash };
}

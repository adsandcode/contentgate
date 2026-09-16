/**
 * The guards. Behaviour is fixed by ../../fixtures/cases.json, which the Python
 * implementation runs too. If these two ever disagree on a case, CI fails and
 * one of them is wrong.
 */

import { createHash } from "node:crypto";
import { visibleText, links as extractLinks, stripped, type Scope } from "./html.js";

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

export function checkInternalLinks(
  html: string, moneyPaths: string[], scope: Scope = null, excludeClasses: string[] = [],
  requireFigure = false, extraEvidence: string[] = [],
): { problems: string[]; found: string[] } {
  const problems: string[] = [];
  const found = extractLinks(html, scope, excludeClasses).filter(
    (h) => moneyPaths.some((p) => h.startsWith(p) || h.includes("/" + p.replace(/^\//, ""))));
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

const CLAIM = /(guaranteed\s+(profit|win|return|income)|guarantees?\s+profit|sure\s+win|risk[-\s]?free\s+(profit|return)|can.?t\s+lose|保證獲利|保證賺|穩賺|必勝|包贏|穩定獲利|穩定盈利)/i;
const PERF = /(win\s*rate\s*\d|hit\s*rate\s*\d|roi\s*\d+\s*x|returns?\s+of\s+\d+\s*%|\d+\s*%\s+win\s+rate|勝率\s*\d|命中率\s*\d|報酬率\s*\d|獲利\s*\d+\s*(%|倍|萬))/i;
const SAFE = /(\bno\b|\bnot\b|\bnever\b|\bnone\b|\bwithout\b|\bavoid\b|\bblock\b|\breject\b|\bprohibit\b|\bban\b|\bforbid\b|\bdisclaim\b|\bmakes? no\b|\bfree of\b|\brather than\b|\binstead of\b|\bsuch as\b|\bwording\b|\bclaims?\b|\bcannot\b|\bdo(es)? not\b|不做|不提供|不會|不得|嚴禁|禁止|沒有|無法|攔下|擋下|檢查|審查|避免|排除)/i;

export function checkClaims(text: string): Array<{ kind: string; sentence: string }> {
  const hits: Array<{ kind: string; sentence: string }> = [];
  for (const raw of text.split(/[。；！\n.!;]/)) {
    const s = raw.trim();
    if (!s || SAFE.test(s)) continue;
    if (CLAIM.test(s)) hits.push({ kind: "claim", sentence: s.slice(0, 120) });
    if (PERF.test(s)) hits.push({ kind: "performance", sentence: s.slice(0, 120) });
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

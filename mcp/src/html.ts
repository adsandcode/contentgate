/**
 * A deliberately small HTML reader.
 *
 * It exists to answer two questions and no others: what text is visible inside
 * a given element, and which links are inside it. Both answers must match the
 * Python implementation exactly, because the two run the same fixture file.
 *
 * Using a full DOM library here would be easier and would also make the two
 * implementations disagree on edge cases that no test covers.
 */

import { HTML5_ENTITIES, INVALID_CHARREFS, INVALID_CODEPOINTS } from "./entities.js";

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);
const NON_TEXT = new Set(["script", "style", "template", "noscript"]);

export interface Token {
  kind: "start" | "end" | "text";
  tag?: string;
  classes?: Set<string>;
  text?: string;
  selfClosing?: boolean;
}

/**
 * Exactly the characters for which Python's str.isspace() is true. JavaScript's
 * \s is a different set (it adds U+FEFF and lacks U+001C-U+001F and U+0085), so
 * both implementations spell the set out and collapse, strip and split on it.
 */
export const WS = "\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0\u1680"
  + "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
  + "\u2028\u2029\u202f\u205f\u3000";
/** The same set as a regular-expression character class body. */
export const WS_CLASS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a"
  + "\\u2028\\u2029\\u202f\\u205f\\u3000";

/** Python's str.strip(chars): remove any of `chars` from both ends. */
export function stripChars(s: string, chars: string = WS): string {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu;

/**
 * A port of Python's html.unescape, table and all. The Python implementation
 * decodes references with it, and a character count must not depend on which
 * implementation did the counting.
 */
export function unescape(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(CHARREF, (_m, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const num = parseInt(body.slice(hex ? 2 : 1).replace(/;$/, ""), hex ? 16 : 10);
      if (has(INVALID_CHARREFS, String(num))) return INVALID_CHARREFS[String(num)];
      if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) return "\ufffd";
      if (INVALID_CODEPOINTS.has(num)) return "";
      return String.fromCodePoint(num);
    }
    if (has(HTML5_ENTITIES, body)) return HTML5_ENTITIES[body];
    // The longest prefix that is a known name, as the HTML standard defines it.
    for (let x = body.length - 1; x > 1; x--) {
      if (has(HTML5_ENTITIES, body.slice(0, x))) return HTML5_ENTITIES[body.slice(0, x)] + body.slice(x);
    }
    return "&" + body;
  });
}

export function tokenize(html: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      if (i < html.length) out.push({ kind: "text", text: unescape(html.slice(i)) });
      break;
    }
    if (lt > i) out.push({ kind: "text", text: unescape(html.slice(i, lt)) });

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt)) {
      const end = html.indexOf(">", lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const gt = html.indexOf(">", lt);
    if (gt === -1) {
      out.push({ kind: "text", text: unescape(html.slice(lt)) });
      break;
    }
    const raw = html.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (!raw) continue;

    if (raw[0] === "/") {
      out.push({ kind: "end", tag: raw.slice(1).trim().toLowerCase() });
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const m = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(body);
    if (!m) continue;
    const tag = m[1].toLowerCase();
    const attrs: Record<string, string> = {};
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
    attrRe.lastIndex = m[0].length;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(body)) !== null) {
      let v = a[2] ?? "";
      if (v.length > 1 && (v[0] === '"' || v[0] === "'")) v = v.slice(1, -1);
      attrs[a[1].toLowerCase()] = unescape(v);
    }
    const classes = new Set((attrs["class"] ?? "").split(/\s+/).filter(Boolean));
    out.push({ kind: "start", tag, classes, selfClosing, text: attrs["href"] });
  }
  return out;
}

export type Scope = [string, string] | null;

interface WalkState {
  inside: boolean;
  depth: number;
  skipDepth: number | null;
  nonText: number;
}

/** Walk tokens, calling `onText` and `onLink` only where content counts. */
function walk(
  tokens: Token[],
  scope: Scope,
  excludeClasses: Iterable<string>,
  onText: (s: string) => void,
  onLink?: (href: string) => void,
): void {
  const exclude = new Set(excludeClasses);
  const st: WalkState = { inside: scope === null, depth: 0, skipDepth: null, nonText: 0 };

  for (const t of tokens) {
    if (t.kind === "start") {
      if (t.tag && VOID.has(t.tag)) continue;
      if (t.selfClosing) continue;
      if (!st.inside) {
        if (scope && t.tag === scope[0] && t.classes?.has(scope[1])) {
          st.inside = true;
          st.depth = 0;
        }
        continue;
      }
      st.depth += 1;
      if (st.skipDepth === null && t.classes) {
        for (const c of t.classes) {
          if (exclude.has(c)) { st.skipDepth = st.depth; break; }
        }
      }
      if (t.tag && NON_TEXT.has(t.tag)) st.nonText += 1;
      if (t.tag === "a" && st.skipDepth === null && st.nonText === 0 && t.text && onLink) {
        onLink(t.text);
      }
    } else if (t.kind === "end") {
      if (t.tag && VOID.has(t.tag)) continue;
      if (!st.inside) continue;
      if (t.tag && NON_TEXT.has(t.tag) && st.nonText > 0) st.nonText -= 1;
      if (st.skipDepth !== null && st.depth === st.skipDepth) st.skipDepth = null;
      if (scope && t.tag === scope[0] && st.depth === 0) { st.inside = false; continue; }
      st.depth -= 1;
    } else if (st.inside && st.skipDepth === null && st.nonText === 0) {
      onText(t.text ?? "");
    }
  }
}

export function visibleText(html: string, scope: Scope = null, excludeClasses: Iterable<string> = []): string {
  const chunks: string[] = [];
  walk(tokenize(html), scope, excludeClasses, (s) => chunks.push(s));
  return chunks.join(" ");
}

export function links(html: string, scope: Scope = null, excludeClasses: Iterable<string> = []): string[] {
  const found: string[] = [];
  walk(tokenize(html), scope, excludeClasses, () => {}, (h) => found.push(h));
  return found;
}

/** Serialise the document with excluded subtrees removed, for hashing. */
export function stripped(html: string, stripClasses: Iterable<string> = [],
                        stripTags: Iterable<string> = ["script", "style", "noscript"]): string {
  const cls = new Set(stripClasses);
  const tags = new Set(stripTags);
  const out: string[] = [];
  const stack: string[] = [];
  let skipDepth: number | null = null;

  for (const t of tokenize(html)) {
    if (t.kind === "start") {
      if (t.selfClosing) { if (skipDepth === null) out.push(`<${t.tag}/>`); continue; }
      if (t.tag && !VOID.has(t.tag)) stack.push(t.tag);
      if (skipDepth !== null) continue;
      let excluded = t.tag ? tags.has(t.tag) : false;
      if (!excluded && t.classes) for (const c of t.classes) if (cls.has(c)) { excluded = true; break; }
      if (excluded) { skipDepth = stack.length; continue; }
      out.push(`<${t.tag}>`);
    } else if (t.kind === "end") {
      if (t.tag && VOID.has(t.tag)) continue;
      if (skipDepth !== null && stack.length === skipDepth) {
        skipDepth = null;
        stack.pop();
        continue;
      }
      if (stack.length && stack[stack.length - 1] === t.tag) stack.pop();
      else if (t.tag && stack.includes(t.tag)) { while (stack.length && stack.pop() !== t.tag) { /* unwind */ } }
      if (skipDepth === null) out.push(`</${t.tag}>`);
    } else if (skipDepth === null) {
      out.push(t.text ?? "");
    }
  }
  return out.join("").replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------------ *
 * Tags with their attributes, for the page-level checks.
 *
 * The Python implementation reads links, images and icon declarations with
 * the standard library's html.parser. This is a port of that parser's
 * tokenisation, as of the 2025 rewrite that brought it in line with the HTML
 * standard: the same regular expressions, the same raw-text elements (whose
 * contents are never tags), the same handling of comments, declarations and a
 * bare "<" in text. On well-formed markup every supported Python version and
 * this port agree; on badly malformed markup older Pythons differ from newer
 * ones, and this follows the newer.
 * ------------------------------------------------------------------------ */

export interface TagToken {
  kind: "start" | "end";
  tag: string;
  /** In source order, duplicates kept; a valueless attribute has value "". */
  attrs: Array<[string, string]>;
  selfClosing: boolean;
}

const TAGFIND = /([a-zA-Z][^\t\n\r\f />]*)(?:[\t\n\r\f ]|\/(?!>))*/y;
const ATTRFIND = /((?<=['"\t\n\r\f /])[^\t\n\r\f />][^\t\n\r\f /=>]*)([\t\n\r\f ]*=[\t\n\r\f ]*('[^']*'|"[^"]*"|(?!['"])[^>\t\n\r\f ]*))?(?:[\t\n\r\f ]|\/(?!>))*/y;
const LOCATE_TAG_END = /[a-zA-Z][^\t\n\r\f />]*[\t\n\r\f /]*(?:(?<=['"\t\n\r\f /])[^\t\n\r\f />][^\t\n\r\f /=>]*(?:[\t\n\r\f ]*=[\t\n\r\f ]*(?:'[^']*'|"[^"]*"|(?!['"])[^>\t\n\r\f ]*))?[\t\n\r\f /]*)*>?/y;
const COMMENT_CLOSE = /--!?>/g;
const COMMENT_ABRUPT_CLOSE = /-?>/y;
const LETTER = /[a-zA-Z]/;
/** Elements whose content is text, never markup (raw text and RCDATA). */
const RAW_TEXT = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes", "textarea", "title"]);

/**
 * `<![if !IE]>` and `<![ CDATA[` crash older versions of Python's parser, so
 * the Python side turns the opener into text first. Done here too, so both
 * read the same document.
 */
export function neutraliseMarkedSections(html: string): string {
  return html.split("<![").join("&lt;![");
}

/** Where the tag starting at `from` (just after "<" or "</") ends, or -1 if it never does. */
function tagEnd(s: string, from: number): number {
  LOCATE_TAG_END.lastIndex = from;
  LOCATE_TAG_END.exec(s);
  const end = LOCATE_TAG_END.lastIndex;
  return s[end - 1] === ">" ? end : -1;
}

export function scanTags(html: string): TagToken[] {
  const s = neutraliseMarkedSections(html);
  const n = s.length;
  const out: TagToken[] = [];
  let rawText: string | null = null;
  let i = 0;

  while (i < n) {
    if (rawText !== null) {
      const close: RegExp = new RegExp("</" + rawText + "(?=[\\t\\n\\r\\f />])", "gi");
      close.lastIndex = i;
      const m = close.exec(s);
      if (!m) break; // the rest of the document is text
      i = m.index;
    } else {
      const j = s.indexOf("<", i);
      if (j < 0) break;
      i = j;
    }

    if (LETTER.test(s[i + 1] ?? "")) {
      // Start tag. One that never closes swallows the rest of the document.
      const endpos = tagEnd(s, i + 1);
      if (endpos < 0) break;
      TAGFIND.lastIndex = i + 1;
      const tag: string = TAGFIND.exec(s)![1].toLowerCase();
      let k = TAGFIND.lastIndex;
      const attrs: Array<[string, string]> = [];
      while (k < endpos) {
        ATTRFIND.lastIndex = k;
        const m = ATTRFIND.exec(s);
        if (!m) break;
        let value = "";
        if (m[2]) {
          value = m[3] ?? "";
          if ((value[0] === "'" && value[value.length - 1] === "'")
              || (value[0] === '"' && value[value.length - 1] === '"')) value = value.slice(1, -1);
          if (value) value = unescape(value);
        }
        attrs.push([m[1].toLowerCase(), value]);
        k = ATTRFIND.lastIndex;
      }
      const end = stripChars(s.slice(k, endpos));
      i = endpos;
      if (end !== ">" && end !== "/>") continue; // read as text, not a tag
      const selfClosing = end === "/>";
      out.push({ kind: "start", tag, attrs, selfClosing });
      if (!selfClosing) {
        if (tag === "plaintext") break;
        if (RAW_TEXT.has(tag)) rawText = tag;
      }
    } else if (s.startsWith("</", i)) {
      if (s.indexOf(">", i + 2) < 0) break;
      if (!LETTER.test(s[i + 2] ?? "")) {
        // "</>" is ignored; anything else is a bogus comment up to the next ">".
        i = s[i + 2] === ">" ? i + 3 : s.indexOf(">", i + 2) + 1;
        continue;
      }
      const endpos = tagEnd(s, i + 2);
      if (endpos < 0) break;
      TAGFIND.lastIndex = i + 2;
      out.push({ kind: "end", tag: TAGFIND.exec(s)![1].toLowerCase(), attrs: [], selfClosing: false });
      rawText = null;
      i = endpos;
    } else if (s.startsWith("<!--", i)) {
      COMMENT_CLOSE.lastIndex = i + 4;
      const m = COMMENT_CLOSE.exec(s);
      if (m) { i = m.index + m[0].length; continue; }
      COMMENT_ABRUPT_CLOSE.lastIndex = i + 4;
      if (!COMMENT_ABRUPT_CLOSE.exec(s)) break; // an unclosed comment runs to the end
      i = COMMENT_ABRUPT_CLOSE.lastIndex;
    } else if (s.startsWith("<?", i) || s.startsWith("<!", i)) {
      // Processing instruction, doctype or bogus comment: up to the next ">".
      const from = s.slice(i, i + 9).toLowerCase() === "<!doctype" ? i + 9 : i + 2;
      const gt = s.indexOf(">", from);
      if (gt < 0) break;
      i = gt + 1;
    } else {
      i += 1; // a "<" that starts nothing is text
    }
  }
  return out;
}

/** Attribute map where a repeated attribute keeps its first value, as browsers do. */
export function firstWins(attrs: Array<[string, string]>): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const [k, v] of attrs) if (!(k in out)) out[k] = v;
  return out;
}

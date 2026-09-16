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

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function unescape(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
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

/**
 * Which host a link really goes to, decided the way a browser decides it.
 *
 * A line-for-line port of src/contentgate/urls.py; see that file for the
 * reasoning. Both are held to fixtures/cases.json.
 */

import { WS, stripChars } from "./html.js";

let c0 = "";
for (let c = 0; c <= 0x20; c++) c0 += String.fromCharCode(c);
/** Python's whitespace plus C0 controls and space: what is stripped from an href. */
export const STRIP = [...new Set(WS + c0)].join("");

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;
const HTTP_PREFIX = /^(https?):(\/*)/i;
const ASCII = /^[\x00-\x7f]*$/;

/** [scheme, netloc or null, tail], the way Python's urlsplit reads them. */
export function split(url: string): [string, string | null, string] {
  let scheme = "", u = url;
  const i = u.indexOf(":");
  if (i > 0 && SCHEME.test(u.slice(0, i))) {
    scheme = u.slice(0, i).toLowerCase();
    u = u.slice(i + 1);
  }
  if (!u.startsWith("//")) return [scheme, null, u];
  let end = u.length;
  for (const c of "/?#") {
    const k = u.indexOf(c, 2);
    if (k >= 0) end = Math.min(end, k);
  }
  return [scheme, u.slice(2, end), u.slice(end)];
}

/** Lower-cased host of a netloc, or "" when there is none or it is invalid. */
export function hostname(netloc: string): string {
  if (netloc.includes("[") !== netloc.includes("]")) return "";
  if (!ASCII.test(netloc)) {
    // urllib refuses a netloc that NFKC normalisation would turn into one
    // carrying URL delimiters (a fullwidth solidus, for instance).
    let n = netloc;
    for (const c of "@:#?") n = n.split(c).join("");
    const folded = n.normalize("NFKC");
    if (folded !== n && [..."/?#@:"].some((c) => folded.includes(c))) return "";
  }
  const hostinfo = netloc.slice(netloc.lastIndexOf("@") + 1);
  let host: string;
  if (hostinfo.includes("[")) {
    const bracketed = hostinfo.slice(hostinfo.indexOf("[") + 1);
    host = bracketed.includes("]") ? bracketed.slice(0, bracketed.indexOf("]")) : bracketed;
  } else {
    host = hostinfo.includes(":") ? hostinfo.slice(0, hostinfo.indexOf(":")) : hostinfo;
  }
  return host.toLowerCase();
}

/** [scheme, host, path] of the page's own URL; throws unless absolute http(s) with a host. */
export function pageParts(url: string): [string, string, string] {
  const [scheme, netloc, tail] = split(stripChars(url, STRIP));
  const host = netloc ? hostname(netloc) : "";
  if ((scheme !== "http" && scheme !== "https") || !host)
    throw new Error(`page url must be an absolute http(s) URL with a host: '${url}'`);
  return [scheme, host, tail.split(/[?#]/)[0]];
}

/**
 * Host a browser opens for `href` on a page at pageScheme://pageHost.
 * "" for targets that are not http(s) (mailto:, tel:, javascript:) and for
 * URLs a browser would refuse.
 */
export function resolveHost(href: string, pageScheme: string, pageHost: string): string {
  let u = stripChars(href.replace(/[\t\n\r]/g, ""), STRIP).split("\\").join("/");
  const m = HTTP_PREFIX.exec(u);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (m[2].length >= 2 || scheme !== pageScheme) u = scheme + "://" + u.slice(m[0].length);
  } else if (u.startsWith("//")) {
    u = "//" + u.replace(/^\/+/, "");
  }
  const [scheme, netloc] = split(u);
  if (scheme === "" || scheme === pageScheme) return netloc ? hostname(netloc) : pageHost;
  if ((scheme !== "http" && scheme !== "https") || netloc === null) return "";
  return hostname(netloc);
}

/** host is domain itself or a subdomain of it, on a label boundary. */
export function under(host: string, domain: string): boolean {
  return host === domain || host.endsWith("." + domain);
}

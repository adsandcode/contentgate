"""Performance-claim scanner for regulated verticals.

Finance, gambling and health copy gets rejected, or worse, for stating outcomes
as facts. The hard part is not finding the phrase, it is not firing on the
sentence that exists precisely to disclaim it. "We do not make guaranteed profit
claims" contains the phrase and is the opposite of a violation.

So every match is checked against the surrounding clause for negation or
compliance framing before it counts.
"""

import re

CLAIM = (r"(guaranteed\s+(profit|win|return|income)|guarantees?\s+profit|"
         r"sure\s+win|risk[-\s]?free\s+(profit|return)|can.?t\s+lose|"
         r"保證獲利|保證賺|穩賺|必勝|包贏|穩定獲利|穩定盈利)")

PERF = (r"(win\s*rate\s*\d|hit\s*rate\s*\d|roi\s*\d+\s*x|"
        r"returns?\s+of\s+\d+\s*%|\d+\s*%\s+win\s+rate|"
        r"勝率\s*\d|命中率\s*\d|報酬率\s*\d|獲利\s*\d+\s*(%|倍|萬))")

SAFE = (r"(\bno\b|\bnot\b|\bnever\b|\bnone\b|\bwithout\b|\bavoid\b|\bblock\b|"
        r"\breject\b|\bprohibit\b|\bban\b|\bforbid\b|\bdisclaim\b|\bmakes? no\b|"
        r"\bfree of\b|\brather than\b|\binstead of\b|\bsuch as\b|\bwording\b|"
        r"\bclaims?\b|\bcannot\b|\bdo(es)? not\b|"
        r"不做|不提供|不會|不得|嚴禁|禁止|沒有|無法|攔下|擋下|檢查|審查|避免|排除)")

SENTENCE_SPLIT = r"[。；！\n\.!;]"


def check(text, claim_pattern=CLAIM, perf_pattern=PERF, safe_pattern=SAFE):
    """Return a list of (kind, sentence) for affirmative claims only."""
    hits = []
    for sentence in re.split(SENTENCE_SPLIT, text):
        s = sentence.strip()
        if not s:
            continue
        if re.search(safe_pattern, s, re.I):
            continue
        if re.search(claim_pattern, s, re.I):
            hits.append(("claim", s[:120]))
        if re.search(perf_pattern, s, re.I):
            hits.append(("performance", s[:120]))
    return hits

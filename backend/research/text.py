"""Text helpers: exact-quote verification and lightweight candidate retrieval (TF-IDF)."""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter

_QUOTES = {"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "−": "-", " ": " "}
_ELLIPSIS = re.compile(r"\s*(?:\.\.\.|…)\s*")

STOPWORDS = set(
    "a an and are as at be been but by for from had has have in into is it its of on or that the their there these they this those to was were "
    "which while with within without we our not no than then so such can could may might also more most other some any each both between "
    "using used use study studies paper results result found find shows show showed however thus therefore".split()
)


def normalize(text: str) -> str:
    """Normalise text so quotes survive PDF line breaks, hyphenation and curly punctuation."""
    text = unicodedata.normalize("NFKC", text or "")
    for src, dst in _QUOTES.items():
        text = text.replace(src, dst)
    text = text.replace("­", "")
    text = re.sub(r"-\s*\n\s*", "", text)  # hyphenated line breaks: "reten-\ntion"
    text = re.sub(r"\s+", " ", text)
    return text.strip().casefold()


def quote_in_text(quote: str, text: str, min_chars: int = 12) -> bool:
    """True if every fragment of `quote` (split on ellipses) occurs verbatim in `text`."""
    haystack = normalize(text)
    fragments = [normalize(f).strip(" \"'.,;:") for f in _ELLIPSIS.split(quote or "")]
    fragments = [f for f in fragments if f]
    if not fragments:
        return False
    if sum(len(f) for f in fragments) < min_chars:
        return False
    return all(f in haystack for f in fragments)


def tokens(text: str) -> list[str]:
    out = []
    for word in re.findall(r"[a-z0-9]+", (text or "").lower()):
        if len(word) < 3 or word in STOPWORDS:
            continue
        if len(word) > 4 and word.endswith("ing"):
            word = word[:-3]
        elif len(word) > 3 and word.endswith("es"):
            word = word[:-2]
        elif len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        out.append(word)
    return out


class TfIdf:
    """Tiny TF-IDF index over a list of texts. Retrieval only: similarity is not evidence."""

    def __init__(self, texts: list[str]):
        self.docs = [Counter(tokens(t)) for t in texts]
        df: Counter[str] = Counter()
        for doc in self.docs:
            df.update(doc.keys())
        n = len(self.docs)
        self.idf = {term: math.log((n + 1) / (count + 1)) + 1 for term, count in df.items()}
        self.vectors = [self._vector(doc) for doc in self.docs]

    def _vector(self, doc: Counter) -> dict[str, float]:
        vec = {t: (1 + math.log(c)) * self.idf.get(t, 1.0) for t, c in doc.items()}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        return {t: v / norm for t, v in vec.items()}

    def cosine(self, i: int, j: int) -> float:
        a, b = self.vectors[i], self.vectors[j]
        if len(a) > len(b):
            a, b = b, a
        return sum(v * b.get(t, 0.0) for t, v in a.items())

    def shared_terms(self, i: int, j: int, limit: int = 5) -> list[str]:
        a, b = self.vectors[i], self.vectors[j]
        shared = [(a[t] * b[t], t) for t in a if t in b]
        shared.sort(reverse=True)
        return [t for _, t in shared[:limit]]

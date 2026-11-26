import asyncio
import json
import warnings

import pytest

warnings.filterwarnings("ignore")
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from research import llm, service  # noqa: E402
from research.schemas import ItemIn  # noqa: E402
from research.text import normalize, quote_in_text  # noqa: E402

client = TestClient(main.app)

PAGE1 = "Spaced retrieval practice improved six-week retention in under-\ngraduates (d = 0.52). Participants were 84 first-year students."
PAGE2 = "We did not test conceptually complex material. The sample came from a single university."


def fake_model(monkeypatch, *replies):
    """Script the model: each call returns the next reply (dicts are JSON-encoded)."""
    calls = []
    queue = list(replies)

    async def _call(messages, max_tokens=1800, temperature=0.2, model=None):
        calls.append(messages)
        reply = queue.pop(0) if len(queue) > 1 else queue[0]
        if callable(reply):
            reply = reply(messages)
        return reply if isinstance(reply, str) else json.dumps(reply)

    monkeypatch.setattr(llm, "call_model", _call)
    return calls


# ---------------------------------------------------------------------------- text helpers
def test_quote_matching_survives_pdf_artifacts():
    assert quote_in_text("improved six-week retention in undergraduates", PAGE1)  # hyphenated line break
    assert quote_in_text("\u201cSpaced retrieval practice improved six-week retention\u201d", PAGE1)  # wrapped in curly quotes
    assert quote_in_text("participants' scores rose", "The participants\u2019 scores rose sharply.")  # curly vs straight apostrophe
    assert quote_in_text("Spaced retrieval practice ... 84 first-year students", PAGE1)  # ellipsis fragments
    assert not quote_in_text("spaced practice harmed retention in undergraduates", PAGE1)
    assert not quote_in_text("short", "short text")  # too short to be meaningful
    assert normalize("A  B\n C") == "a b c"


def test_extract_json_handles_reasoning_and_fences():
    assert llm.extract_json('<think>hmm {"x":1}</think>\n```json\n{"a": {"b": "}"}}\n```') == {"a": {"b": "}"}}
    with pytest.raises(ValueError):
        llm.extract_json("no json here")


def test_model_json_retry_then_failure(monkeypatch):
    calls = fake_model(monkeypatch, "not json", {"items": []})
    assert asyncio.run(llm.chat_json("s", "u")) == {"items": []}
    assert len(calls) == 2
    fake_model(monkeypatch, "still not json")
    with pytest.raises(llm.ModelFailure):
        asyncio.run(llm.chat_json("s", "u"))


# ----------------------------------------------------------------------------- extraction
def extract_body(**over):
    body = {"research_question": "Does spaced retrieval help?", "document": {"id": "d1", "title": "Study A", "authors": "Lee, K.", "year": 2021},
            "pages": [{"page": 1, "text": PAGE1}, {"page": 2, "text": PAGE2}], "max_items": 10}
    body.update(over)
    return body


def test_extract_labels_provenance_and_drops_invented_quotes(monkeypatch):
    fake_model(monkeypatch, {"items": [
        {"type": "finding", "title": "Spaced retrieval improved retention", "content": "Retention was higher at six weeks.", "stated_by": "author",
         "evidence": [{"page": 1, "quote": "improved six-week retention in undergraduates (d = 0.52)"}]},
        {"type": "claim", "title": "Spacing always works", "content": "Spacing works for everything.", "stated_by": "author",
         "evidence": [{"page": 1, "quote": "Spacing works for everything and everyone, always."}]},  # invented quote
        {"type": "limitation", "title": "Single university sample", "content": "Only one university.", "stated_by": "author",
         "evidence": [{"page": 1, "quote": "The sample came from a single university."}]},  # right text, wrong page -> relocated to page 2
        {"type": "method", "title": "Probably a mixed design", "content": "Interpretation.", "stated_by": "ai", "evidence": []},
        {"type": "banana", "title": "Bad type", "content": "x", "evidence": []},
    ]})
    out = client.post("/research-map/extract", json=extract_body()).json()
    by_title = {i["title"]: i for i in out["items"]}
    assert by_title["Spaced retrieval improved retention"]["provenance"] == "source-stated"
    assert by_title["Spaced retrieval improved retention"]["evidence"][0]["verified"] is True
    assert by_title["Spacing always works"]["provenance"] == "ai-interpretation"  # claims "author" but no verifiable quote
    assert by_title["Spacing always works"]["evidence"] == []
    assert by_title["Single university sample"]["evidence"][0]["page"] == 2
    assert by_title["Probably a mixed design"]["provenance"] == "ai-interpretation"
    assert "Bad type" not in by_title
    assert any("not found verbatim" in w for w in out["warnings"])


def test_extract_without_key_is_503_and_empty_text_is_422(monkeypatch):
    assert client.post("/research-map/extract", json=extract_body()).status_code == 503
    r = client.post("/research-map/extract", json=extract_body(pages=[{"page": 1, "text": "   "}]))
    assert r.status_code == 422


def test_extract_model_garbage_is_502(monkeypatch):
    fake_model(monkeypatch, "garbage")
    r = client.post("/research-map/extract", json=extract_body())
    assert r.status_code == 502 and "valid structured output" in r.json()["detail"]


# ------------------------------------------------------------------------------ discovery
def item(i, kind, title, content, doc="d1", quotes=()):
    return {"id": i, "type": kind, "title": title, "content": content, "document_id": doc, "provenance": "source-stated",
            "evidence": [{"page": 1, "quote": q, "document_id": doc} for q in quotes]}


ITEMS = [
    item("a", "finding", "Spaced retrieval improved retention", "Spaced retrieval practice improved six-week retention in undergraduates.", "d1", ["improved six-week retention in undergraduates"]),
    item("b", "finding", "No benefit for complex material", "Spaced retrieval practice showed no retention benefit for complex statistics material after eight weeks.", "d2", ["no retention benefit for complex statistics material"]),
    item("c", "claim", "Spaced retrieval improves retention", "Spaced retrieval practice improves long term retention in undergraduate students.", "d1"),
    item("t", "task", "Email supervisor", "Email the supervisor about retention", "d1"),
    item("z", "method", "Bayesian hierarchical model", "Posterior sampling with weakly informative priors.", "d3"),
]


def labels_by_pair(messages):
    """Map frozenset of item ids -> the P-label the service gave that pair in the prompt."""
    import re
    text = messages[-1]["content"]
    out = {}
    for label, block in re.findall(r'<pair label="(P\d+)"[^>]*>(.*?)</pair>', text, re.S):
        out[frozenset(re.findall(r"\(id: ([^)]+)\)", block))] = label
    return out


def test_discovery_validates_and_ranks(monkeypatch):
    def scripted(messages):
        p = labels_by_pair(messages)
        return {"threads": [
            {"pair": p[frozenset("ab")], "from": "b", "to": "a", "relationship": "contradicts", "explanation": "Different outcome for complex material after a longer delay.",
             "evidence": [{"item_id": "b", "quote": "no retention benefit for complex statistics material"}, {"item_id": "a", "quote": "this sentence was invented by the model"}],
             "uncertainty": "Different delays and materials.", "confidence": "medium"},
            {"pair": p[frozenset("ac")], "from": "a", "to": "c", "relationship": "supports", "explanation": "The finding backs the general claim.", "evidence": [], "uncertainty": "", "confidence": "high"},
            {"pair": "P99", "from": "a", "to": "b", "relationship": "supports", "explanation": "unknown pair label should be dropped"},
            {"pair": p[frozenset("bc")], "from": "b", "to": "c", "relationship": "teleports", "explanation": "invalid relationship should be dropped"},
        ]}
    calls = fake_model(monkeypatch, scripted)
    body = {"research_question": "q", "items": ITEMS, "connections": []}
    out = client.post("/research-map/discover-threads", json=body).json()
    prompt = json.dumps(calls)
    assert "Email supervisor" not in prompt  # tasks are never candidates
    threads = {frozenset((t["from"], t["to"])): t for t in out["threads"]}
    contra = threads[frozenset("ab")]
    assert contra["relationship"] == "contradicts" and len(contra["evidence"]) == 1  # fabricated quote removed
    assert contra["evidence_missing"] is False and contra["confidence"] == "medium"
    supports = threads[frozenset("ac")]
    assert supports["evidence_missing"] is True and supports["confidence"] == "low"  # even though the model said "high"
    assert "No source passage was cited" in supports["uncertainty"]
    assert out["dropped"] >= 3 and any("not found in the source text" in w for w in out["warnings"])
    assert out["threads"][0]["rank"] >= out["threads"][-1]["rank"]


def test_discovery_skips_existing_pairs_and_needs_no_model_when_nothing_new(monkeypatch):
    calls = fake_model(monkeypatch, {"threads": []})
    conns = [{"from": "a", "to": "b", "relationship": "contradicts", "status": "rejected"}, {"from": "a", "to": "c", "status": "confirmed"}, {"from": "b", "to": "c", "status": "suggested"}]
    out = client.post("/research-map/discover-threads", json={"items": ITEMS, "connections": conns}).json()
    assert out["threads"] == [] and calls == []  # dismissed/confirmed/suggested pairs are not proposed again


def test_discovery_focus_limits_pairs(monkeypatch):
    calls = fake_model(monkeypatch, {"threads": []})
    client.post("/research-map/discover-threads", json={"items": ITEMS, "focus_item_ids": ["b"]})
    prompt = json.dumps(calls)
    assert "<pair label" in prompt
    pairs = service.candidate_pairs([ItemIn(**i) for i in ITEMS], [], {"b"})
    assert pairs and all("b" in (p["a"].id, p["b"].id) for p in pairs)


# --------------------------------------------------------------------- other endpoints
def test_investigate_fills_gaps_and_clamps_enum(monkeypatch):
    fake_model(monkeypatch, {"context": [{"factor": "population", "a": "84 first-year students", "b": "Not stated", "note": "differs"}, {"factor": "mood", "a": "x", "b": "y"}],
                             "assessment": "totally_wrong", "rationale": "Insufficient details.", "qualified_statement": "", "checks": ["Check the delay interval"]})
    out = client.post("/research-map/investigate-thread", json={"a": ITEMS[0], "b": ITEMS[1], "relationship": "contradicts"}).json()
    assert [c["factor"] for c in out["context"]] == ["population", "definitions", "conditions", "data", "outcomes"]
    assert out["context"][1]["a"] == service.NOT_STATED
    assert out["assessment"] == "insufficient_information"


def test_gaps_require_real_support(monkeypatch):
    fake_model(monkeypatch, {"gaps": [
        {"title": "Complex material untested", "description": "Observed in this collection.", "basis": "limitation", "support": ["a", "ghost"], "counterevidence": ["b", "ghost2"], "next_search": ["spaced retrieval complex material"]},
        {"title": "Invented gap", "description": "No support", "support": ["ghost"]},
    ]})
    out = client.post("/research-map/explore-gaps", json={"items": ITEMS}).json()
    assert len(out["gaps"]) == 1
    gap = out["gaps"][0]
    assert gap["support"] == ["a"] and gap["counterevidence"] == ["b"] and gap["status"] == "candidate" and gap["scope"] == "observed_in_collection"
    assert "wider literature" in out["disclaimer"]


def test_outline_strips_unknown_ids(monkeypatch):
    fake_model(monkeypatch, {"sections": [{"heading": "Evidence for spacing", "purpose": "p", "item_ids": ["a", "c", "ghost"]}, {"heading": "Methods", "purpose": "p", "item_ids": []}]})
    out = client.post("/research-map/generate-outline", json={"items": ITEMS}).json()
    assert out["sections"][0]["item_ids"] == ["a", "c"] and out["sections"][0]["needs_evidence"] is False
    assert out["sections"][1]["needs_evidence"] is True and out["warnings"]


def test_ask_cites_only_real_nodes(monkeypatch):
    fake_model(monkeypatch, {"answer": "Retention improved [N1] but not for complex material [N2]; see also [N9].", "sufficient": True, "missing": ""})
    out = client.post("/research-map/ask", json={"question": "Does it work?", "nodes": ITEMS[:2]}).json()
    assert out["refs"] == {"N1": "a", "N2": "b"} and "[unverified]" in out["answer"] and out["sufficient"] is True
    fake_model(monkeypatch, {"answer": "It definitely works.", "sufficient": True})
    out = client.post("/research-map/ask", json={"question": "Does it work?", "nodes": ITEMS[:2]}).json()
    assert out["sufficient"] is False and out["citations"] == []  # an uncited answer is never presented as supported
    empty = client.post("/research-map/ask", json={"question": "anything", "nodes": []}).json()
    assert empty["sufficient"] is False


# --------------------------------------------------------------------------------- pdf + api
def make_pdf(pages):
    import pymupdf
    doc = pymupdf.open()
    for text in pages:
        page = doc.new_page()
        if text:
            page.insert_textbox(pymupdf.Rect(60, 60, 540, 760), text, fontsize=11)
        else:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 60), False)
            pix.clear_with(200)
            page.insert_image(pymupdf.Rect(60, 60, 200, 200), pixmap=pix)
    return doc.tobytes()


def test_pdf_pages_keep_numbers():
    data = make_pdf(["First page: spaced retrieval improved retention in undergraduates over six weeks.", "Second page: limitations include a single university sample."])
    r = client.post("/research-map/pdf/parse", files={"file": ("study.pdf", data, "application/pdf")}).json()
    assert [p["page"] for p in r["pages"]] == [1, 2] and "spaced retrieval" in r["pages"][0]["text"] and "single university" in r["pages"][1]["text"]
    assert r["page_count"] == 2


def test_scanned_and_invalid_pdfs_are_rejected_clearly():
    scanned = client.post("/research-map/pdf/parse", files={"file": ("scan.pdf", make_pdf([""]), "application/pdf")})
    assert scanned.status_code == 422 and "scanned" in scanned.json()["detail"]
    bad = client.post("/research-map/pdf/parse", files={"file": ("x.pdf", b"not a pdf", "application/pdf")})
    assert bad.status_code == 422


def test_health_and_cors():
    health = client.get("/health").json()
    assert health["ok"] and health["research_map"] is True and health["model_configured"] is False
    ok = client.options("/research-map/ask", headers={"Origin": "http://127.0.0.1:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert ok.headers.get("access-control-allow-origin") == "http://127.0.0.1:5173"
    file_origin = client.options("/research-map/ask", headers={"Origin": "null", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert file_origin.headers.get("access-control-allow-origin") == "null"
    evil = client.options("/research-map/ask", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert "access-control-allow-origin" not in evil.headers


def test_item_labels_in_model_text_are_replaced_with_titles():
    from research.service import _name_items
    from research.schemas import ItemIn
    a = ItemIn(id="a", type="finding", title="Main causes of plastic pollution", content="x")
    b = ItemIn(id="b", type="contribution", title="Land versus sea sources", content="y")
    out = _name_items("Item A details causes that exemplify the argument in Item B. The item B claim is one-sided.", a, b)
    assert "Item A" not in out and "Item B" not in out and "item B" not in out
    assert "“Main causes of plastic pollution”" in out and "“Land versus sea sources”" in out


TOPICS = ["vocabulary", "statistics", "anatomy", "history", "chemistry", "geography", "music", "law"]


def test_discover_keeps_partial_results_when_one_batch_fails(monkeypatch):
    items = [ItemIn(id=f"i{n}", type="finding", title=f"{TOPICS[n]} retention result", content=f"Spaced retrieval practice improved retention of {TOPICS[n]} in undergraduates after {n + 2} weeks.", document_id=f"d{n % 3}") for n in range(8)]
    monkeypatch.setattr(service, "PAIRS_PER_CALL", 5)
    state = {"n": 0}

    async def _call(messages, max_tokens=1800, temperature=0.2, model=None):
        state["n"] += 1
        if state["n"] == 1:
            return json.dumps({"threads": [{"pair": "P1", "relationship": "related_to", "explanation": "Both report the same retention effect."}]})
        raise llm.ModelFailure("provider busy")

    monkeypatch.setattr(llm, "call_model", _call)
    out = asyncio.run(service.discover_threads(service.DiscoverRequest(items=items, documents=[], connections=[], research_question="q")))
    assert out["threads"] and any("failed on some of the item pairs" in w for w in out["warnings"])


def test_reasoning_steps_use_the_reasoning_model_and_the_rest_use_the_default(monkeypatch):
    monkeypatch.setenv("NEBIUS_MODEL", "fast-model")
    monkeypatch.setenv("NEBIUS_MODEL_REASONING", "deep-model")
    seen = []

    async def _call(messages, max_tokens=1800, temperature=0.2, model=None):
        seen.append(model)
        return json.dumps({"threads": []})

    monkeypatch.setattr(llm, "call_model", _call)
    items = [ItemIn(id=f"i{n}", type="finding", title=f"{TOPICS[n]} retention result", content=f"Spaced retrieval practice improved retention of {TOPICS[n]} in undergraduates.", document_id=f"d{n}") for n in range(3)]
    asyncio.run(service.discover_threads(service.DiscoverRequest(items=items, documents=[], connections=[], research_question="q")))
    asyncio.run(llm.chat_json("s", "u"))
    assert seen == ["deep-model", None]
    monkeypatch.delenv("NEBIUS_MODEL_REASONING")
    assert llm.reasoning_model() == "fast-model"

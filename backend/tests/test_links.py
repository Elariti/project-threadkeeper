"""Finding links: thread discovery robustness (retries, cut-off replies, fallback model, skipping checked pairs)
and downloading open-access PDFs."""
import asyncio
import json

import httpx
import pytest

from research import fetch, llm, service
from research.schemas import DiscoverRequest


def items():
    return [
        {"id": "a", "type": "finding", "title": "Spaced retrieval improved retention", "content": "Spaced retrieval practice improved six-week retention of vocabulary in undergraduates."},
        {"id": "b", "type": "claim", "title": "Retrieval practice helps retention", "content": "Retrieval practice improves long-term retention of vocabulary for undergraduates."},
        {"id": "c", "type": "limitation", "title": "Vocabulary only", "content": "Only vocabulary retention was tested; retrieval effects on complex material are unknown."},
    ]


# ------------------------------------------------------------------------------ model calls
def test_salvage_keeps_complete_entries_of_a_cut_off_reply():
    reply = '<think>long</think>```json\n{"threads":[{"pair":"P1","note":"a } brace"},{"pair":"P2"},{"pair":"P3","fr'
    assert llm.salvage_list(reply, "threads") == [{"pair": "P1", "note": "a } brace"}, {"pair": "P2"}]
    assert llm.salvage_list("nothing here", "threads") == []


def test_chat_json_uses_salvage_instead_of_failing(monkeypatch):
    async def cut_off(messages, max_tokens=1800, temperature=0.2, model=None):
        return '{"items":[{"type":"finding","title":"T"},{"type":"claim","ti'
    monkeypatch.setattr(llm, "call_model", cut_off)
    data = asyncio.run(llm.chat_json("s", "u", list_key="items"))
    assert data["items"] == [{"type": "finding", "title": "T"}] and data["_truncated"]


def test_reasoning_model_failure_falls_back_to_main_model(monkeypatch):
    monkeypatch.setenv("NEBIUS_MODEL", "main-model")
    seen = []

    async def flaky(messages, max_tokens=1800, temperature=0.2, model=None):
        seen.append(model)
        if model == "slow-reasoner":
            raise llm.ModelFailure("The model took too long to respond.")
        return '{"threads": []}'
    monkeypatch.setattr(llm, "call_model", flaky)
    data = asyncio.run(llm.chat_json("s", "u", model="slow-reasoner", list_key="threads"))
    assert data == {"threads": [], "_fallback": True} and seen == ["slow-reasoner", "main-model"]


def test_transient_errors_are_retried(monkeypatch):
    monkeypatch.setenv("NEBIUS_API_KEY", "k")
    monkeypatch.setenv("MODEL_RETRIES", "2")
    calls = {"n": 0}

    async def post(base, key, payload):
        calls["n"] += 1
        if calls["n"] < 3:
            request = httpx.Request("POST", "https://x/chat/completions")
            raise httpx.HTTPStatusError("busy", request=request, response=httpx.Response(503, request=request))
        return {"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]}

    async def no_sleep(_):
        return None
    monkeypatch.setattr(llm, "_post_once", post)
    monkeypatch.setattr(llm.asyncio, "sleep", no_sleep)
    assert asyncio.run(llm.call_model([{"role": "user", "content": "hi"}])) == "ok"
    assert calls["n"] == 3


def test_empty_reply_cut_by_token_limit_gets_more_room(monkeypatch):
    monkeypatch.setenv("NEBIUS_API_KEY", "k")
    budgets = []

    async def post(base, key, payload):
        budgets.append(payload["max_tokens"])
        if len(budgets) == 1:
            return {"choices": [{"message": {"content": "<think>still thinking"}, "finish_reason": "length"}]}
        return {"choices": [{"message": {"content": '{"a":1}'}, "finish_reason": "stop"}]}
    monkeypatch.setattr(llm, "_post_once", post)
    assert asyncio.run(llm.call_model([{"role": "user", "content": "hi"}], max_tokens=1000)) == '{"a":1}'
    assert budgets == [1000, 2000]


# --------------------------------------------------------------------------- discovery
def test_discovery_reports_checked_pairs_and_skips_them_next_time(monkeypatch):
    sent = []

    async def model(messages, max_tokens=1800, temperature=0.2, model=None):
        sent.append(messages[1]["content"])
        return json.dumps({"threads": []})
    monkeypatch.setattr(llm, "call_model", model)
    first = asyncio.run(service.discover_threads(DiscoverRequest(items=items())))
    assert first["checked"] and len(sent) == 1
    again = asyncio.run(service.discover_threads(DiscoverRequest(items=items(), checked_pairs=first["checked"])))
    assert again["all_checked"] and again["considered"] == 0 and len(sent) == 1  # no model call the second time
    assert "already been checked" in again["warnings"][0]


# ------------------------------------------------------------------------------ full text
def make_pdf(text="Spaced retrieval practice improved six-week retention in undergraduates."):
    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    return doc.tobytes()


def run_fetch(handler, url="https://example.org/paper.pdf"):
    return asyncio.run(fetch.fetch_pdf(url, transport=httpx.MockTransport(handler), check_host=False))


def test_fetch_follows_redirects_and_reads_the_pdf():
    body = make_pdf()

    def handler(request):
        if request.url.path == "/paper.pdf":
            return httpx.Response(302, headers={"location": "/files/real.pdf"})
        return httpx.Response(200, content=body, headers={"content-type": "application/pdf"})
    out = run_fetch(handler)
    assert out["file_name"] == "real.pdf" and "retention" in out["pages"][0]["text"]


def test_fetch_refuses_web_pages_and_paywalls():
    with pytest.raises(fetch.FetchError, match="web page"):
        run_fetch(lambda r: httpx.Response(200, content=b"<html>landing</html>", headers={"content-type": "text/html"}))
    with pytest.raises(fetch.FetchError, match="refused"):
        run_fetch(lambda r: httpx.Response(403))


def test_fetch_refuses_private_addresses_and_other_schemes():
    with pytest.raises(fetch.FetchError, match="local or private"):
        asyncio.run(fetch.fetch_pdf("http://127.0.0.1:8000/x.pdf"))
    with pytest.raises(fetch.FetchError, match="http and https"):
        asyncio.run(fetch.fetch_pdf("file:///etc/passwd"))


# ------------------------------------------------------------- extraction honesty + duplicates
APETE_P1 = ("This abandoned, lost, or otherwise discarded fishing gear (ALDFG) is considered the largest contributor to sea-based "
            "sources of marine plastic debris. Approximately 80 % of marine plastic pollution originates from land (Li et al., 2016). "
            "Entanglement in ALDFG can lead to organism mortality and injury of many species.")


def run_extract(monkeypatch, items, existing=()):
    from research.schemas import ExtractRequest

    async def model(messages, max_tokens=1800, temperature=0.2, model=None):
        return json.dumps({"items": items})
    monkeypatch.setattr(llm, "call_model", model)
    req = ExtractRequest(document={"id": "d1", "title": "Fishing plastic waste"}, pages=[{"page": 1, "text": APETE_P1}], existing=list(existing))
    return asyncio.run(service.extract_items(req))


def test_extraction_labels_partial_support_fragments_and_citations(monkeypatch):
    out = run_extract(monkeypatch, [
        {"type": "claim", "title": "ALDFG is largest sea-based source of marine plastic debris", "stated_by": "author", "source_kind": "own",
         "content": "Abandoned, lost, or otherwise discarded fishing gear is the largest contributor to sea-based marine plastic debris according to UNEP.",
         "evidence": [{"page": 1, "quote": "This abandoned, lost, or otherwise discarded fishing gear (ALDFG) is considered the largest contributor to sea-based sources of marine plastic debris."}]},
        {"type": "finding", "title": "Land-based sources dominate", "stated_by": "author", "source_kind": "own",
         "content": "Approximately 80 % of marine plastic pollution originates from land.",
         "evidence": [{"page": 1, "quote": "Approximately 80 % of marine plastic pollution originates from land (Li et al., 2016)."}]},
        {"type": "claim", "title": "Entanglement harms organisms", "stated_by": "author", "content": "Entanglement in fishing gear can lead to organism mortality and injury.",
         "evidence": [{"page": 1, "quote": "This abandoned, lost, or otherwise discarded fishing gear (ALDFG"}]},
    ])
    by = {i["title"]: i for i in out["items"]}
    unep = by["ALDFG is largest sea-based source of marine plastic debris"]
    assert unep["provenance"] == "partly-sourced" and any("UNEP" in n for n in unep["support_notes"])
    land = by["Land-based sources dominate"]
    assert land["provenance"] == "source-stated" and land["attribution"] == "cited"  # "(Li et al., 2016)" is someone else's work
    frag = by["Entanglement harms organisms"]
    assert frag["evidence"] == [] and frag["provenance"] == "ai-interpretation"  # a cut-off fragment is not evidence
    assert any("fragments" in w for w in out["warnings"])


def test_extraction_skips_what_is_already_on_the_map(monkeypatch):
    item = {"type": "finding", "title": "Land-based sources dominate marine plastic", "stated_by": "author", "content": "Approximately 80 % of marine plastic pollution originates from land.",
            "evidence": [{"page": 1, "quote": "Approximately 80 % of marine plastic pollution originates from land (Li et al., 2016)."}]}
    twin = {**item, "type": "claim", "title": "Most marine plastic comes from land"}
    out = run_extract(monkeypatch, [item, twin], existing=[{"title": "Other", "content": "", "quotes": []}])
    assert len(out["items"]) == 1  # the same quote under another type is a duplicate
    again = run_extract(monkeypatch, [item], existing=[{"title": "Land sources", "content": "x", "quotes": ["Approximately 80 % of marine plastic pollution originates from land"]}])
    assert again["items"] == [] and any("already extracted" in w for w in again["warnings"])


# -------------------------------------------------------------------- better thread proposals
def mk(i, doc, title, content, quotes=()):
    from research.schemas import ItemIn
    return ItemIn(id=i, type="finding", title=title, content=content, document_id=doc, evidence=[{"page": 1, "quote": q} for q in quotes])


def test_candidates_skip_duplicates_and_put_cross_paper_pairs_first():
    loop = "ALDFG in the marine environment leads to marine organism mortality through ingestion of or entanglement in macroplastics."
    items = [
        mk("a1", "apete", "ALDFG mortality feedback loops reduce fish availability", "Mortality from fishing gear reduces fish availability.", [loop]),
        mk("a2", "apete", "ALDFG mortality reduces fish stocks in a reinforcing loop", "The loop: gear mortality reduces fish stocks.", ["The CLD construction began with the understanding that " + loop]),
        mk("s1", "signa", "Entanglement causes injury and impaired swimming", "Entanglement in fishing gear and plastic causes injury, mortality and impaired swimming of marine organisms."),
        mk("t1", "tekman", "914 species affected by entanglement", "914 marine species are affected by entanglement in plastic and fishing gear, causing mortality."),
    ]
    pairs = service.candidate_pairs(items, [], set(), limit=10)
    keys = [frozenset((p["a"].id, p["b"].id)) for p in pairs]
    assert frozenset(("a1", "a2")) not in keys  # same point restated: never a thread
    assert pairs and pairs[0]["cross"] and sum(p["cross"] for p in pairs) >= len(pairs) - 1


def test_reasoned_reply_direction_none_and_label_leaks(monkeypatch):
    items = [mk("x", "d1", "Land-based sources dominate", "About 80% of marine plastic comes from land; fishing gear matters regionally."),
             mk("y", "d2", "Fishing gear dominates the Garbage Patch", "52% of plastics in the Great Pacific Garbage Patch come from fishing; 80% of mega-plastics are nets."),
             mk("z", "d3", "Garbage Patch plastic is mostly fishing nets", "Fishing nets dominate floating mega-plastic in the Garbage Patch, unlike land sources.")]

    def reply(messages):
        import re
        text = messages[-1]["content"]
        labels = dict((frozenset(re.findall(r"\(id: ([^)]+)\)", block)), label) for label, block in re.findall(r'<pair label="(P\d+)"[^>]*>(.*?)</pair>', text, re.S))
        out = []
        for ids, label in labels.items():
            if ids == frozenset("xy"):
                out.append({"pair": label, "reasoning": "A says land dominates globally; B says fishing dominates one gyre.", "relationship": "contradicts", "direction": "B->A",
                            "explanation": "B's fishing share pulls against A, as in P2's case.", "uncertainty": "Different scope: global inputs vs one gyre.", "confidence": "medium",
                            "evidence": [{"item": "B", "quote": "52% of plastics in the Great Pacific Garbage Patch come from fishing"}]})
            else:
                out.append({"pair": label, "relationship": "none", "reasoning": "Same point."})
        return json.dumps({"threads": out})

    async def model(messages, max_tokens=1800, temperature=0.2, model=None):
        return reply(messages)
    monkeypatch.setattr(llm, "call_model", model)
    out = asyncio.run(service.discover_threads(DiscoverRequest(items=[i.model_dump() for i in items])))
    t = out["threads"][0]
    assert (t["from"], t["to"]) == ("y", "x") and t["relationship"] == "contradicts" and t["cross_source"]
    assert "P2" not in t["explanation"] and "B's" not in t["explanation"] and "Fishing gear dominates the Garbage Patch" in t["explanation"]
    assert out["no_relationship"] >= 1 and out["dropped"] == 0 and out["tensions"] == 1


def test_self_check_fixes_direction_and_type_and_drops_weak(monkeypatch):
    monkeypatch.setenv("THREAD_SELF_CHECK", "1")
    items = [mk("x", "d1", "Exposure to nanoplastics is underestimated", "Exposure concentrations of small plastic particles are likely underestimated."),
             mk("y", "d2", "Lab microplastic doses exceed field levels", "Laboratory experiments use microplastic concentrations far higher than field exposure levels."),
             mk("z", "d3", "Field exposure to microplastics is variable", "Field exposure to plastic particles varies and concentrations are hard to measure.")]

    async def model(messages, max_tokens=1800, temperature=0.2, model=None):
        import re
        text = messages[-1]["content"]
        if "<thread label" in text:
            checks = []
            for label, block in re.findall(r'<thread label="(T\d+)">(.*?)</thread>', text, re.S):
                if "Lab microplastic doses" in block and "nanoplastics is underestimated" in block:
                    checks.append({"thread": label, "verdict": "fix", "relationship": "contradicts", "direction": "swap", "reason": "This is a tension, not support."})
                else:
                    checks.append({"thread": label, "verdict": "drop", "reason": "Restates the same point."})
            return json.dumps({"checks": checks})
        labels = re.findall(r'<pair label="(P\d+)"', text)
        return json.dumps({"threads": [{"pair": l, "relationship": "supports", "direction": "A->B", "explanation": "These items connect on exposure levels.", "confidence": "medium"} for l in labels]})
    monkeypatch.setattr(llm, "call_model", model)
    out = asyncio.run(service.discover_threads(DiscoverRequest(items=[i.model_dump() for i in items])))
    assert len(out["threads"]) == 1
    t = out["threads"][0]
    assert t["relationship"] == "contradicts" and t["checked"] == "fixed" and "tension" in t["check_note"]
    assert any("second, critical reading" in w for w in out["warnings"])

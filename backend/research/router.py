from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile

from . import fetch, llm, pdf, service
from .schemas import AskRequest, DiscoverRequest, ExtractRequest, FetchRequest, GapRequest, InvestigateRequest, OutlineRequest

router = APIRouter(prefix="/research-map", tags=["research map"])


async def _run(coro):
    try:
        return await coro
    except llm.ModelNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except llm.ModelFailure as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/pdf/parse")
async def parse_pdf(file: UploadFile = File(...)):
    data = await file.read(pdf.MAX_BYTES + 1)
    try:
        return pdf.parse_pdf(data, file.filename or "document.pdf")
    except pdf.PdfError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/fetch-fulltext")
async def fetch_fulltext(req: FetchRequest):
    """Download an open-access PDF by link (from the scholarly search) and read it like an uploaded PDF."""
    try:
        return await fetch.fetch_pdf(req.url)
    except fetch.FetchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/extract")
async def extract(req: ExtractRequest):
    return await _run(service.extract_items(req))


@router.post("/discover-threads")
async def discover(req: DiscoverRequest):
    return await _run(service.discover_threads(req))


@router.post("/investigate-thread")
async def investigate(req: InvestigateRequest):
    return await _run(service.investigate(req))


@router.post("/explore-gaps")
async def gaps(req: GapRequest):
    return await _run(service.explore_gaps(req))


@router.post("/generate-outline")
async def outline(req: OutlineRequest):
    return await _run(service.generate_outline(req))


@router.post("/ask")
async def ask(req: AskRequest):
    return await _run(service.ask_map(req))

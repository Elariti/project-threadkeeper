"""Request models and shared vocabulary for the research endpoints."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

ITEM_TYPES = ("claim", "finding", "limitation", "method", "question", "gap", "contribution", "decision", "task")
EXTRACT_TYPES = ("claim", "finding", "method", "limitation", "question")
RELATIONS = ("supports", "contradicts", "qualifies", "extends", "explains", "motivates", "informs", "depends_on", "related_to")
CONFIDENCE = ("low", "medium", "high")
ASSESSMENTS = ("genuine_tension", "possibly_compatible", "insufficient_information")
CONTEXT_FACTORS = ("population", "definitions", "conditions", "data", "outcomes")

Text = Field(default="", max_length=6000)


class Page(BaseModel):
    page: int = Field(ge=1, le=5000)
    text: str = Field(max_length=40000)


class DocMeta(BaseModel):
    id: str = Field(max_length=80)
    title: str = Field(default="", max_length=400)
    authors: str = Field(default="", max_length=400)
    year: Optional[int] = None


class EvidenceIn(BaseModel):
    page: Optional[int] = None
    quote: str = Field(max_length=2000)
    document_id: Optional[str] = None


class ItemIn(BaseModel):
    id: str = Field(max_length=80)
    type: str = Field(max_length=30)
    title: str = Field(default="", max_length=400)
    content: str = Field(default="", max_length=4000)
    document_id: Optional[str] = None
    provenance: str = "unverified"
    evidence: list[EvidenceIn] = Field(default_factory=list, max_length=12)


class ConnIn(BaseModel):
    id: Optional[str] = None
    from_id: str = Field(alias="from", max_length=80)
    to_id: str = Field(alias="to", max_length=80)
    relationship: str = "related_to"
    explanation: str = Field(default="", max_length=2000)
    status: str = "suggested"

    model_config = {"populate_by_name": True}


class ExistingItem(BaseModel):
    title: str = Field(default="", max_length=400)
    content: str = Field(default="", max_length=4000)
    quotes: list[str] = Field(default_factory=list, max_length=12)


class ExtractRequest(BaseModel):
    research_question: str = Field(default="", max_length=1500)
    document: DocMeta
    existing: list[ExistingItem] = Field(default_factory=list, max_length=300)  # items already extracted from this document
    pages: list[Page] = Field(min_length=1, max_length=250)
    max_items: int = Field(default=12, ge=1, le=30)


class DiscoverRequest(BaseModel):
    research_question: str = Field(default="", max_length=1500)
    items: list[ItemIn] = Field(max_length=400)
    documents: list[DocMeta] = Field(default_factory=list, max_length=100)
    connections: list[ConnIn] = Field(default_factory=list, max_length=2000)
    focus_item_ids: list[str] = Field(default_factory=list, max_length=400)
    # Pairs already sent to the model before that came back with no relationship; skipped so each run looks at new pairs.
    checked_pairs: list[list[str]] = Field(default_factory=list, max_length=5000)
    self_check: bool = True  # a second, critical model pass that keeps, fixes or drops each proposal
    top_k: int = Field(default=8, ge=1, le=20)


class InvestigateRequest(BaseModel):
    research_question: str = Field(default="", max_length=1500)
    relationship: str = "related_to"
    explanation: str = Field(default="", max_length=2000)
    a: ItemIn
    b: ItemIn
    a_document: Optional[DocMeta] = None
    b_document: Optional[DocMeta] = None


class GapRequest(BaseModel):
    research_question: str = Field(default="", max_length=1500)
    items: list[ItemIn] = Field(max_length=400)
    connections: list[ConnIn] = Field(default_factory=list, max_length=2000)
    documents: list[DocMeta] = Field(default_factory=list, max_length=100)


class OutlineRequest(BaseModel):
    research_question: str = Field(default="", max_length=1500)
    items: list[ItemIn] = Field(max_length=400)
    connections: list[ConnIn] = Field(default_factory=list, max_length=2000)
    documents: list[DocMeta] = Field(default_factory=list, max_length=100)


class FetchRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    research_question: str = Field(default="", max_length=1500)
    nodes: list[ItemIn] = Field(default_factory=list, max_length=40)
    connections: list[ConnIn] = Field(default_factory=list, max_length=200)
    documents: list[DocMeta] = Field(default_factory=list, max_length=100)

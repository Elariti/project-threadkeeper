"""Download an open-access PDF by URL (for papers found through the scholarly search) and read it like an upload.

Guard rails: http(s) only, public hosts only (no loopback / private / link-local addresses, checked again after every
redirect), at most 5 redirects, a size cap, a timeout, and the body must really be a PDF. Landing pages (HTML) are
refused with a message telling the user to open the link instead.
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from . import pdf

MAX_REDIRECTS = 5
TIMEOUT = httpx.Timeout(30.0, connect=10.0)
USER_AGENT = "Threadkeeper/0.3 (research desk; open-access full text)"


class FetchError(Exception):
    """The message is safe to show to the user."""


async def _public_host(host: str) -> None:
    if not host:
        raise FetchError("The link has no host name.")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise FetchError(f"Could not find the server {host}.") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise FetchError("That link points to a local or private address, which is not allowed.")


def _check_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise FetchError("Only http and https links can be downloaded.")
    return parsed.hostname or ""


async def fetch_pdf(url: str, transport: httpx.AsyncBaseTransport | None = None, check_host: bool = True) -> dict[str, Any]:
    current = url
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False, transport=transport,
                                 headers={"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*;q=0.5"}) as client:
        for _ in range(MAX_REDIRECTS + 1):
            host = _check_url(current)
            if check_host:
                await _public_host(host)
            try:
                async with client.stream("GET", current) as response:
                    if response.status_code in (301, 302, 303, 307, 308) and response.headers.get("location"):
                        current = urljoin(current, response.headers["location"])
                        continue
                    if response.status_code in (401, 402, 403):
                        raise FetchError("The publisher refused the download (it may need a subscription or a browser). Open the link and download the PDF yourself.")
                    if response.status_code >= 400:
                        raise FetchError(f"The server answered HTTP {response.status_code} for that link.")
                    declared = int(response.headers.get("content-length") or 0)
                    if declared > pdf.MAX_BYTES:
                        raise FetchError("That PDF is larger than 25 MB.")
                    chunks: list[bytes] = []
                    size = 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > pdf.MAX_BYTES:
                            raise FetchError("That PDF is larger than 25 MB.")
                        chunks.append(chunk)
                    data = b"".join(chunks)
            except httpx.TimeoutException as exc:
                raise FetchError("The download took too long. Try again, or open the link and download the PDF yourself.") from exc
            except httpx.HTTPError as exc:
                raise FetchError(f"The download failed ({type(exc).__name__}).") from exc
            if not data.lstrip()[:5].startswith(b"%PDF"):
                raise FetchError("That link opens a web page, not a PDF. Open it in your browser, download the PDF, then add it with “PDF”.")
            name = urlparse(current).path.rsplit("/", 1)[-1] or "paper.pdf"
            try:
                return pdf.parse_pdf(data, name if name.lower().endswith(".pdf") else f"{name}.pdf")
            except pdf.PdfError as exc:
                raise FetchError(str(exc)) from exc
        raise FetchError("The link redirected too many times.")

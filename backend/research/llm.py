"""Model access (Nebius Token Factory, OpenAI-compatible) with defensive JSON handling."""
from __future__ import annotations

import asyncio
import json
import os
import re
import weakref
from typing import Any

import httpx


class ModelNotConfigured(Exception):
    """No API key is set on the server."""


class ModelFailure(Exception):
    """The model call failed or returned unusable output. The message is safe to show the user."""


_LIMITS: "weakref.WeakKeyDictionary[Any, asyncio.Semaphore]" = weakref.WeakKeyDictionary()


def _slot() -> asyncio.Semaphore:
    """At most MODEL_CONCURRENCY model calls in flight at once (per event loop), so parallel work stays under provider rate limits."""
    loop = asyncio.get_running_loop()
    if loop not in _LIMITS:
        _LIMITS[loop] = asyncio.Semaphore(max(1, int(os.getenv("MODEL_CONCURRENCY", "3"))))
    return _LIMITS[loop]


DEFAULT_MODEL = "nvidia/NVIDIA-Nemotron-Nano-9B-v2"


def reasoning_model() -> str:
    """Model for the judgement-heavy steps (threads, contradictions, gaps). Falls back to NEBIUS_MODEL if not set."""
    return os.getenv("NEBIUS_MODEL_REASONING") or os.getenv("NEBIUS_MODEL", DEFAULT_MODEL)


RETRY_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


def _retries() -> int:
    try:
        return max(0, min(4, int(os.getenv("MODEL_RETRIES", "2"))))
    except ValueError:
        return 2


async def _post_once(base: str, key: str, payload: dict[str, Any]) -> dict[str, Any]:
    async with _slot(), httpx.AsyncClient(timeout=float(os.getenv("MODEL_TIMEOUT_SECONDS", "120"))) as client:
        response = await client.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json=payload)
    response.raise_for_status()
    return response.json()


async def call_model(messages: list[dict[str, str]], max_tokens: int = 1800, temperature: float = 0.2, model: str | None = None) -> str:
    """One chat completion. Transient failures (rate limits, 5xx, timeouts, dropped connections) are retried with
    back-off (MODEL_RETRIES, default 2). A reply cut off by the token limit with no content is retried once with more room."""
    key = os.getenv("NEBIUS_API_KEY")
    if not key:
        raise ModelNotConfigured("AI is not configured. Set NEBIUS_API_KEY in backend/.env. Your map and notes still work without it.")
    base = os.getenv("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1/").rstrip("/")
    model = model or os.getenv("NEBIUS_MODEL", DEFAULT_MODEL)
    payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    attempts = _retries() + 1
    grew = False
    for attempt in range(attempts):
        last = attempt == attempts - 1
        try:
            data = await _post_once(base, key, payload)
            choice = data["choices"][0]
            content = choice.get("message", {}).get("content") or ""
            # Reasoning models can spend the whole budget thinking and return nothing usable. Give them more room once.
            if not _THINK.sub("", content).strip() and choice.get("finish_reason") == "length" and not grew:
                grew = True
                payload = {**payload, "max_tokens": min(int(payload["max_tokens"] * 2), 8000)}
                continue
            return content
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            if code in RETRY_STATUS and not last:
                retry_after = exc.response.headers.get("retry-after", "")
                wait = float(retry_after) if retry_after.replace(".", "", 1).isdigit() else 1.5 * (2 ** attempt)
                await asyncio.sleep(min(wait, 12.0))
                continue
            if code == 429:
                raise ModelFailure("The model provider is rate limiting requests (HTTP 429). Wait a minute and try again, or lower MODEL_CONCURRENCY in backend/.env.") from exc
            if code == 404:
                raise ModelFailure(f"Model provider returned HTTP 404: the model \u201c{model}\u201d was not found. Check the exact model ID for this provider and the NEBIUS_BASE_URL.") from exc
            if code in (401, 403):
                raise ModelFailure(f"Model provider returned HTTP {code}: the API key was rejected or lacks access to \u201c{model}\u201d.") from exc
            raise ModelFailure(f"Model provider returned HTTP {code} for model \u201c{model}\u201d. Check the model ID and API access.") from exc
        except httpx.TimeoutException as exc:
            if not last:
                await asyncio.sleep(1.0)
                continue
            raise ModelFailure("The model took too long to respond. Try again, or try fewer items.") from exc
        except (httpx.TransportError, httpx.RemoteProtocolError) as exc:
            if not last:
                await asyncio.sleep(1.5 * (2 ** attempt))
                continue
            raise ModelFailure(f"Could not reach the model provider ({type(exc).__name__}). Check your internet connection.") from exc
        except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as exc:
            raise ModelFailure(f"AI request failed ({type(exc).__name__}).") from exc
    raise ModelFailure("The model returned an empty reply. Try again.")


_THINK = re.compile(r"<think>.*?(?:</think>|$)", re.DOTALL | re.IGNORECASE)  # an unclosed block (cut off) is all thinking
_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def extract_json(text: str) -> Any:
    """Pull the first JSON object out of a model reply (handles <think> blocks and code fences)."""
    text = _THINK.sub("", text or "").strip()
    text = _FENCE.sub("", text).strip()
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object found")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])
    raise ValueError("unterminated JSON object")


def salvage_list(text: str, key: str) -> list[dict[str, Any]]:
    """Recover the complete objects of a JSON array from a reply that was cut off (for example by the token limit).
    '{"threads":[{...},{...},{"pair":"P3","fr' gives the first two objects."""
    text = _FENCE.sub("", _THINK.sub("", text or "")).strip()
    m = re.search(r'"%s"\s*:\s*\[' % re.escape(key), text)
    if not m:
        return []
    out: list[dict[str, Any]] = []
    i, n = m.end(), len(text)
    while i < n:
        while i < n and text[i] in " \t\r\n,":
            i += 1
        if i >= n or text[i] != "{":
            break
        depth, in_str, esc, start = 0, False, False, i
        while i < n:
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(text[start : i + 1])
                        if isinstance(obj, dict):
                            out.append(obj)
                    except json.JSONDecodeError:
                        pass
                    i += 1
                    break
            i += 1
        else:
            break
    return out


async def chat_json(system: str, user: str, max_tokens: int = 1800, model: str | None = None, list_key: str | None = None) -> dict[str, Any]:
    """Ask for a JSON object. If the reply is cut off, keep the complete entries of `list_key`; otherwise retry once
    with a repair prompt. If a separate reasoning model fails outright, fall back to the main model once
    (the result then carries "_fallback": True so the caller can say so)."""
    try:
        return await _chat_json_once(system, user, max_tokens, model, list_key)
    except ModelFailure:
        default = os.getenv("NEBIUS_MODEL", DEFAULT_MODEL)
        if not model or model == default:
            raise
        data = await _chat_json_once(system, user, max_tokens, default, list_key)
        data["_fallback"] = True
        return data


async def _chat_json_once(system: str, user: str, max_tokens: int, model: str | None, list_key: str | None) -> dict[str, Any]:
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    reply = await call_model(messages, max_tokens=max_tokens, model=model)
    try:
        data = extract_json(reply)
    except (ValueError, json.JSONDecodeError):
        if list_key:
            rescued = salvage_list(reply, list_key)
            if rescued:
                return {list_key: rescued, "_truncated": True}
        messages += [{"role": "assistant", "content": reply[:4000]}, {"role": "user", "content": "That was not valid JSON. Reply again with ONLY the JSON object described, no commentary. Keep it short."}]
        reply = await call_model(messages, max_tokens=max_tokens, model=model)
        try:
            data = extract_json(reply)
        except (ValueError, json.JSONDecodeError) as exc:
            rescued = salvage_list(reply, list_key) if list_key else []
            if rescued:
                return {list_key: rescued, "_truncated": True}
            raise ModelFailure("The model did not return valid structured output. Try again.") from exc
    if not isinstance(data, dict):
        raise ModelFailure("The model returned an unexpected structure.")
    return data

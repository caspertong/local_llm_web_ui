from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from app.config import OLLAMA_API_KEY, WEB_SEARCH_MAX_RESULTS

OLLAMA_WEB_SEARCH = "https://ollama.com/api/web_search"
DDG_HTML = "https://html.duckduckgo.com/html/"
WIKI_API = "https://en.wikipedia.org/w/api.php"

_TAG_RE = re.compile(r"<[^>]+>")
_HREF_TITLE_RE = re.compile(
    r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>'
    r'|<a[^>]*href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>(.*?)</a>',
    re.I | re.S,
)
_SNIPPET_RE = re.compile(
    r'class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</(?:a|td|span)>',
    re.I | re.S,
)


@dataclass
class WebHit:
    title: str
    url: str
    content: str


def wrap_web_results(query: str, hits: list[WebHit], warning: Optional[str] = None) -> str:
    attr = html.escape(query, quote=True)
    if not hits:
        inner = warning or "No results."
        return f'<web_search query="{attr}">\n{inner}\n</web_search>'
    parts: list[str] = []
    for i, hit in enumerate(hits, 1):
        snippet = (hit.content or "").strip()
        if len(snippet) > 900:
            snippet = snippet[:900].rstrip() + "…"
        parts.append(f"{i}. {hit.title}\n   {hit.url}\n   {snippet}")
    if warning:
        parts.append(f"[{warning}]")
    return f'<web_search query="{attr}">\n' + "\n\n".join(parts) + "\n</web_search>"


async def search_web(query: str, max_results: int = WEB_SEARCH_MAX_RESULTS) -> tuple[list[WebHit], Optional[str]]:
    q = " ".join(query.split())
    if len(q) > 240:
        q = q[:240].rstrip()
    if not q:
        return [], "Web search skipped: empty query"

    errors: list[str] = []
    if OLLAMA_API_KEY:
        hits, err = await _ollama_search(q, max_results)
        if hits:
            return hits, None
        if err:
            errors.append(err)

    hits, err = await _duckduckgo_search(q, max_results)
    if hits:
        return hits, None
    if err:
        errors.append(err)

    hits, err = await _wikipedia_search(q, max_results)
    if hits:
        return hits, None
    if err:
        errors.append(err)

    return [], "; ".join(errors) or "Web search returned no results"


async def _ollama_search(query: str, max_results: int) -> tuple[list[WebHit], Optional[str]]:
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                OLLAMA_WEB_SEARCH,
                headers={
                    "Authorization": f"Bearer {OLLAMA_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={"query": query, "max_results": max_results},
            )
            if response.status_code >= 400:
                return [], f"Ollama web search HTTP {response.status_code}"
            payload = response.json()
    except httpx.HTTPError as exc:
        return [], f"Ollama web search failed: {exc}"
    except ValueError:
        return [], "Ollama web search returned invalid JSON"

    hits: list[WebHit] = []
    for item in payload.get("results") or []:
        url = (item.get("url") or "").strip()
        title = (item.get("title") or url or "Result").strip()
        content = (item.get("content") or "").strip()
        if url or title:
            hits.append(WebHit(title=title, url=url, content=content))
        if len(hits) >= max_results:
            break
    return hits, None if hits else "Ollama web search returned no results"


async def _duckduckgo_search(query: str, max_results: int) -> tuple[list[WebHit], Optional[str]]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers=headers) as client:
            response = await client.post(DDG_HTML, data={"q": query, "kl": "us-en", "df": ""})
            response.raise_for_status()
            page = response.text
    except httpx.HTTPError as exc:
        return [], f"DuckDuckGo search failed: {exc}"

    hits = _parse_ddg_html(page, max_results)
    return hits, None if hits else "DuckDuckGo returned no results"


def _parse_ddg_html(page: str, max_results: int) -> list[WebHit]:
    hits: list[WebHit] = []
    seen: set[str] = set()
    for match in _HREF_TITLE_RE.finditer(page):
        href = match.group(1) or match.group(3) or ""
        raw_title = match.group(2) if match.group(1) is not None else match.group(4)
        url = _clean_ddg_url(html.unescape(href))
        title = _strip_tags(raw_title or "")
        window = page[match.end() : match.end() + 2000]
        snippet_m = _SNIPPET_RE.search(window)
        snippet = _strip_tags(snippet_m.group(1)) if snippet_m else ""
        if not url or url in seen or "duckduckgo.com" in urlparse(url).netloc:
            continue
        seen.add(url)
        hits.append(WebHit(title=title or url, url=url, content=snippet))
        if len(hits) >= max_results:
            break
    return hits


def _clean_ddg_url(href: str) -> str:
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if "duckduckgo.com" in (parsed.netloc or "") and parsed.path.startswith("/l/"):
        qs = parse_qs(parsed.query)
        uddg = qs.get("uddg") or qs.get("u")
        if uddg:
            return unquote(uddg[0])
    return href


def _strip_tags(raw: str) -> str:
    text = _TAG_RE.sub(" ", html.unescape(raw or ""))
    return " ".join(text.split())


async def _wikipedia_search(query: str, max_results: int) -> tuple[list[WebHit], Optional[str]]:
    params = {
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srlimit": str(max_results),
        "srprop": "snippet",
        "format": "json",
        "utf8": "1",
    }
    headers = {"User-Agent": "HearthLocalUI/1.0 (local chat; web search fallback)"}
    try:
        async with httpx.AsyncClient(timeout=15.0, headers=headers) as client:
            response = await client.get(WIKI_API, params=params)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        return [], f"Wikipedia search failed: {exc}"
    except ValueError:
        return [], "Wikipedia search returned invalid JSON"

    hits: list[WebHit] = []
    for item in (payload.get("query") or {}).get("search") or []:
        title = (item.get("title") or "").strip()
        if not title:
            continue
        slug = title.replace(" ", "_")
        hits.append(
            WebHit(
                title=title,
                url=f"https://en.wikipedia.org/wiki/{slug}",
                content=_strip_tags(item.get("snippet") or ""),
            )
        )
        if len(hits) >= max_results:
            break
    return hits, None if hits else "Wikipedia search returned no results"

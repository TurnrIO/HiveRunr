"""RSS / Atom feed trigger node.

Polls an RSS 2.0 or Atom 1.0 feed URL and returns entries published (or
updated) within the lookback window.  Uses only Python's stdlib
``xml.etree.ElementTree`` and ``urllib.request`` — no extra dependencies.

Designed to be combined with a ``trigger.cron`` schedule so the flow runs
periodically and picks up new items since the last run.

Configuration
-------------
  url               — RSS or Atom feed URL (required)
  lookback_minutes  — return entries published/updated within the last N
                      minutes (default: 60; set 0 to return all entries)
  filter_expression — optional Python expression evaluated per entry; the
                      variable ``entry`` is the entry dict.  Return True to
                      include, False to skip.  Example:
                        'python' in entry.get('title','').lower()
  max_entries       — cap the number of returned entries (default: 50)

Output shape
------------
{
  "entries": [
    {
      "title":     str,
      "link":      str,
      "published": ISO-8601 str,
      "summary":   str,
      "author":    str,
      "id":        str,
    },
    …
  ],
  "count":    N,
  "feed_title": str,
  # First-entry shortcuts (empty when count == 0):
  "title":    entries[0].title,
  "link":     entries[0].link,
  "summary":  entries[0].summary,
  "published":entries[0].published,
}
"""
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

NODE_TYPE = "trigger.rss"
LABEL = "RSS / Atom Feed"

# XML namespaces used in feeds
_NS = {
    "atom":    "http://www.w3.org/2005/Atom",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc":      "http://purl.org/dc/elements/1.1/",
    "media":   "http://search.yahoo.com/mrss/",
}


# ── Date parsing ──────────────────────────────────────────────────────────────

def _parse_date(s: str | None) -> datetime | None:
    """Parse RFC 822 (RSS) or ISO-8601 (Atom) date strings into UTC datetimes."""
    if not s:
        return None
    s = s.strip()
    # Try RFC 822 (RSS pubDate)
    try:
        dt = parsedate_to_datetime(s)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    # Try ISO-8601 variants (Atom <updated>/<published>)
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(s[:25], fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except ValueError:
            pass
    return None


def _to_iso(dt: datetime | None) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else ""


# ── Text helpers ──────────────────────────────────────────────────────────────

def _strip_html(text: str) -> str:
    """Remove HTML tags for a clean plain-text summary."""
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _text(el, *paths, ns=_NS) -> str:
    """Return stripped text from the first matching child element."""
    for path in paths:
        child = el.find(path, ns)
        if child is not None and child.text:
            return child.text.strip()
    return ""


# ── Feed parsers ─────────────────────────────────────────────────────────────

def _parse_rss(root: ET.Element) -> tuple[str, list[dict]]:
    channel = root.find("channel")
    if channel is None:
        return "", []
    feed_title = _text(channel, "title")
    entries = []
    for item in channel.findall("item"):
        title   = _text(item, "title")
        link    = _text(item, "link") or (item.find("link") is not None and item.find("link").get("href", "")) or ""
        pub     = _text(item, "pubDate", "dc:date", ns=_NS)
        summary = _strip_html(_text(item, "description", "content:encoded", ns=_NS))
        author  = _text(item, "author", "dc:creator", ns=_NS)
        guid    = _text(item, "guid")
        entries.append({
            "title":     title,
            "link":      link,
            "published": pub,
            "summary":   summary[:500],
            "author":    author,
            "id":        guid or link,
            "_dt":       _parse_date(pub),
        })
    return feed_title, entries


def _parse_atom(root: ET.Element) -> tuple[str, list[dict]]:
    feed_title = _text(root, "atom:title", ns=_NS)
    entries = []
    for entry in root.findall("atom:entry", _NS):
        title   = _text(entry, "atom:title", ns=_NS)
        link_el = entry.find("atom:link[@rel='alternate']", _NS) or entry.find("atom:link", _NS)
        link    = link_el.get("href", "") if link_el is not None else ""
        pub     = _text(entry, "atom:published", "atom:updated", ns=_NS)
        summary = _strip_html(
            _text(entry, "atom:summary", "atom:content", "content:encoded", ns=_NS)
        )
        author_el = entry.find("atom:author/atom:name", _NS)
        author    = author_el.text.strip() if author_el is not None and author_el.text else ""
        id_       = _text(entry, "atom:id", ns=_NS)
        entries.append({
            "title":     title,
            "link":      link,
            "published": pub,
            "summary":   summary[:500],
            "author":    author,
            "id":        id_ or link,
            "_dt":       _parse_date(pub),
        })
    return feed_title, entries


# ── Main ──────────────────────────────────────────────────────────────────────

def run(config, inp, context, logger, creds=None, **kwargs):
    from app.nodes._utils import _render

    url = _render(config.get("url", ""), context, creds).strip()
    if not url:
        raise ValueError("trigger.rss: 'url' is required")

    lookback_minutes = int(_render(config.get("lookback_minutes", "60"), context, creds) or 60)
    max_entries      = int(_render(config.get("max_entries", "50"),       context, creds) or 50)
    filter_expr      = _render(config.get("filter_expression", ""),       context, creds).strip()

    # ── Fetch feed ────────────────────────────────────────────────────────────
    logger.info("trigger.rss: fetching %s", url)
    req = urllib.request.Request(url, headers={"User-Agent": "HiveRunr/1.0 RSS Trigger"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read()

    root = ET.fromstring(raw)
    tag  = root.tag.lower()

    if "rss" in tag or root.tag == "rss":
        feed_title, entries = _parse_rss(root)
    elif "feed" in tag or "atom" in tag.lower():
        feed_title, entries = _parse_atom(root)
    else:
        # Try RSS channel structure as fallback
        feed_title, entries = _parse_rss(root)
        if not entries:
            feed_title, entries = _parse_atom(root)

    logger.info("trigger.rss: fetched %d entries from '%s'", len(entries), feed_title)

    # ── Apply lookback window ─────────────────────────────────────────────────
    if lookback_minutes > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=lookback_minutes)
        filtered = []
        for e in entries:
            dt = e.get("_dt")
            if dt is None or dt >= cutoff:
                filtered.append(e)
        entries = filtered
        logger.info("trigger.rss: %d entries within lookback window", len(entries))

    # ── Apply filter expression ───────────────────────────────────────────────
    if filter_expr:
        kept = []
        for e in entries:
            try:
                if eval(filter_expr, {"entry": e, "re": re, "__builtins__": {}}):  # noqa: S307
                    kept.append(e)
            except Exception as exc:
                logger.warning("trigger.rss: filter_expression error: %s", exc)
        entries = kept
        logger.info("trigger.rss: %d entries after filter", len(entries))

    # ── Cap and clean ─────────────────────────────────────────────────────────
    entries = entries[:max_entries]
    for e in entries:
        e["published"] = _to_iso(e.pop("_dt", None)) or e.get("published", "")

    first = entries[0] if entries else {}
    return {
        "entries":    entries,
        "count":      len(entries),
        "feed_title": feed_title,
        # First-entry shortcuts
        "title":     first.get("title", ""),
        "link":      first.get("link", ""),
        "summary":   first.get("summary", ""),
        "published": first.get("published", ""),
        "author":    first.get("author", ""),
    }

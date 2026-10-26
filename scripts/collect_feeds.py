
import concurrent.futures
import datetime as dt
import email.utils
import hashlib
import html
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "feeds.json"
DATA_PATH = ROOT / "data" / "news.json"

USER_AGENT = "PulseNewsRSS/1.0 (GitHub Actions RSS reader)"
REQUEST_TIMEOUT = 14
MAX_WORKERS = 12
RETENTION_DAYS = 14


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def iso_date(value):
    if not value:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError):
        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.astimezone(dt.timezone.utc).isoformat()
        except (TypeError, ValueError):
            return None


def clean_text(value):
    value = html.unescape(value or "")
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def child_text(element, names):
    for child in element:
        local_name = child.tag.split("}")[-1].lower()
        if local_name in names and child.text:
            return child.text.strip()
    return ""


def article_id(url):
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:20]


def read_existing():
    try:
        data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        return data.get("articles", [])
    except (OSError, json.JSONDecodeError, AttributeError):
        return []


def fetch_source(category, keywords, domain, limit):
    query = f"{keywords} site:{domain}"
    params = urllib.parse.urlencode({
        "q": query,
        "hl": "en-US",
        "gl": "US",
        "ceid": "US:en"
    })
    feed_url = "https://news.google.com/rss/search?" + params
    request = urllib.request.Request(
        feed_url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/rss+xml, application/xml, text/xml"
        }
    )

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            if response.status != 200:
                return []
            payload = response.read(3_000_000)

        root = ET.fromstring(payload)
        results = []

        # Works with both RSS <item> and Atom <entry>.
        elements = [
            node for node in root.iter()
            if node.tag.split("}")[-1].lower() in ("item", "entry")
        ]

        for entry in elements[:limit]:
            title = child_text(entry, {"title"})
            link = child_text(entry, {"link"})
            summary = child_text(entry, {"description", "summary", "content"})
            published_raw = child_text(
                entry, {"pubdate", "published", "updated", "date"}
            )

            # Atom links often use href instead of element text.
            if not link:
                for node in entry:
                    if node.tag.split("}")[-1].lower() == "link":
                        href = node.attrib.get("href", "")
                        rel = node.attrib.get("rel", "alternate")
                        if href and rel == "alternate":
                            link = href
                            break
                        if href and not link:
                            link = href

            source = ""
            for node in entry:
                if node.tag.split("}")[-1].lower() == "source":
                    source = clean_text(
                        node.text or node.attrib.get("title", "")
                    )
                    break

            title = clean_text(title)
            summary = clean_text(summary)
            link = link.strip()

            if not title or not link:
                continue
            if not link.startswith(("https://", "http://")):
                continue

            published = iso_date(published_raw) or utc_now().isoformat()
            results.append({
                "id": article_id(link),
                "title": title[:400],
                "summary": summary[:900],
                "url": link,
                "publisher": source or domain,
                "category": category,
                "published": published
            })

        return results
    except Exception as exc:
        print(f"[WARN] {category} | {domain}: {type(exc).__name__}: {exc}")
        return []


def main():
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    category_configs = config["categories"]
    per_source = int(config.get("max_articles_per_source", 8))
    per_category = int(config.get("max_articles_per_category", 100))
    total_limit = int(config.get("max_total_articles", 1800))

    jobs = []
    for category in category_configs:
        name = category["name"]
        keywords = category["query"]
        for domain in category["sources"]:
            jobs.append((name, keywords, domain))

    print(f"Starting Pulse News collection: {len(jobs)} source searches")

    fresh = []
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=MAX_WORKERS
    ) as executor:
        futures = [
            executor.submit(fetch_source, name, query, domain, per_source)
            for name, query, domain in jobs
        ]
        for future in concurrent.futures.as_completed(futures):
            try:
                fresh.extend(future.result())
            except Exception as exc:
                print(f"[WARN] Worker failed: {exc}")

    # Keep older stories when some feeds temporarily fail.
    cutoff = utc_now() - dt.timedelta(days=RETENTION_DAYS)
    combined = read_existing() + fresh
    deduped = {}

    for item in combined:
        url = item.get("url", "")
        title = clean_text(item.get("title", ""))
        if not url.startswith(("https://", "http://")) or not title:
            continue

        try:
            published = dt.datetime.fromisoformat(
                item.get("published", "").replace("Z", "+00:00")
            )
            if published.tzinfo is None:
                published = published.replace(tzinfo=dt.timezone.utc)
        except (ValueError, TypeError):
            published = utc_now()

        if published < cutoff:
            continue

        item["title"] = title[:400]
        item["summary"] = clean_text(item.get("summary", ""))[:900]
        item["id"] = item.get("id") or article_id(url)

        # Preserve the newest copy of each URL.
        if url not in deduped or published > dt.datetime.fromisoformat(
            deduped[url]["published"].replace("Z", "+00:00")
        ):
            deduped[url] = item

    articles = list(deduped.values())

    category_order = {
        category["name"]: index
        for index, category in enumerate(category_configs)
    }
    articles.sort(
        key=lambda item: item.get("published", ""),
        reverse=True
    )

    counts = {}
    for article in articles:
        counts[article.get("category", "")] = (
            counts.get(article.get("category", ""), 0) + 1
        )

    # Enforce the configured per-category limit.
    selected = []
    counts = {}
    for article in articles:
        category = article.get("category", "")
        if counts.get(category, 0) >= per_category:
            continue
        counts[category] = counts.get(category, 0) + 1
        selected.append(article)

    selected.sort(key=lambda item: item.get("published", ""), reverse=True)
    selected = selected[:total_limit]

    # Avoid unused imports causing confusion in future edits.
    _ = category_order, time, os

    output = {
        "updatedAt": utc_now().isoformat(),
        "categories": [category["name"] for category in category_configs],
        "total": len(selected),
        "articles": selected
    }

    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )

    print(f"Collection complete: {len(selected)} unique stories")
    print(f"Output written to: {DATA_PATH}")


if __name__ == "__main__":
    main()

"""Step 12: classify every distinct (city, label) into violent / property / minor with Jev.

Input: data/processed/crime_labels.json (from prepare_crime). Each answer is cached in
data/raw/jev/crime/<sha1 of city|label>.json, so each label is classified exactly once;
re-running only sends labels not yet cached. Then writes data/processed/crime_classes.json:
{"city|label": {class, confidence, probabilities, records}} plus a low-confidence report.

Cost: ~450 input tokens per label at ~$0.042 per million (output free), so ~$0.03 for all
1,582 labels (D034). Rate limits aren't published: 4 requests in flight, retries on 429/529.

Labels with Jev confidence below 0.7 then go to Claude (claude_classify.py), cached in
data/raw/claude/crime/. If Claude can't be reached, Jev's answer is used and the label is
marked "pending_claude" so a later run fixes it (D034).

Run: uv run --project pipeline python -m settle_pipeline.classify_crime
"""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

from settle_pipeline.config import RAW_DIR, require_env
from settle_pipeline.claude_classify import classify_with_claude, make_client
from settle_pipeline.jev import CITY_NAMES, RECORD_KIND, crime_request, parse_crime_answer, post_with_retry
from settle_pipeline.prepare_crime import LABELS_FILE, PROCESSED_DIR

CACHE_DIR = RAW_DIR / "jev" / "crime"
CLAUDE_DIR = RAW_DIR / "claude" / "crime"
CLASSES_FILE = PROCESSED_DIR / "crime_classes.json"
LOW_CONFIDENCE = 0.7  # same threshold as the chat router (CLAUDE.md section 6); reported, not dropped
WORKERS = 4


def cache_path(city: str, label: str):
    return CACHE_DIR / f"{hashlib.sha1(f'{city}|{label}'.encode()).hexdigest()}.json"


def claude_path(city: str, label: str):
    return CLAUDE_DIR / f"{hashlib.sha1(f'{city}|{label}'.encode()).hexdigest()}.json"


def run_claude_fallback(low: list[dict]) -> None:
    """Classify low-confidence labels with Claude; cache each answer. Stops quietly on auth errors."""
    import anthropic

    CLAUDE_DIR.mkdir(parents=True, exist_ok=True)
    todo = [l for l in low if not claude_path(l["city"], l["label"]).exists()]
    if not todo:
        return
    print(f"  Claude fallback: {len(todo)} labels to classify")
    client = make_client()
    in_tok = out_tok = 0
    for i, l in enumerate(todo, 1):
        try:
            ans = classify_with_claude(client, CITY_NAMES[l["city"]], RECORD_KIND[l["city"]], l["label"])
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError, anthropic.BadRequestError) as e:
            print(f"  Claude unavailable ({type(e).__name__}): using Jev's answer, marked pending_claude")
            return
        in_tok += ans["input_tokens"]
        out_tok += ans["output_tokens"]
        claude_path(l["city"], l["label"]).write_text(json.dumps({"city": l["city"], "label": l["label"], **ans}))
        if i % 50 == 0 or i == len(todo):
            print(f"  Claude classified {i}/{len(todo)} ({in_tok:,} in / {out_tok:,} out tokens)", flush=True)


def main() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    labels = json.loads(LABELS_FILE.read_text())
    todo = [l for l in labels if not cache_path(l["city"], l["label"]).exists()]
    print(f"  {len(labels)} labels; {len(todo)} to classify ({len(labels) - len(todo)} cached)")

    if todo:
        key = require_env("JEV_API_KEY")

        def classify(item: dict) -> None:
            body = crime_request(item["city"], item["label"])
            resp = post_with_retry(client, body, key)
            parse_crime_answer(resp)  # validate before caching
            cache_path(item["city"], item["label"]).write_text(
                json.dumps({"city": item["city"], "label": item["label"], "request": body, "response": resp})
            )

        with httpx.Client(timeout=30, http2=False) as client, ThreadPoolExecutor(WORKERS) as pool:
            futures = [pool.submit(classify, item) for item in todo]
            for i, f in enumerate(as_completed(futures), 1):
                f.result()  # re-raise any error
                if i % 200 == 0 or i == len(futures):
                    print(f"  classified {i}/{len(futures)}", flush=True)

    jev = {}
    for l in labels:
        cached = json.loads(cache_path(l["city"], l["label"]).read_text())
        jev[(l["city"], l["label"])] = parse_crime_answer(cached["response"])
    low_labels = [l for l in labels if jev[(l["city"], l["label"])]["confidence"] < LOW_CONFIDENCE]
    run_claude_fallback(low_labels)

    out, tokens, low, changed, pending = {}, 0, [], [], 0
    for l in labels:
        ans = jev[(l["city"], l["label"])]
        tokens += ans["input_tokens"] or 0
        entry = {
            "class": ans["class"], "source": "jev", "confidence": ans["confidence"],
            "probabilities": ans["probabilities"], "records": l["records"], "model": ans["model"],
        }
        if ans["confidence"] < LOW_CONFIDENCE:
            low.append((l["city"], l["label"], ans["class"], ans["confidence"], l["records"]))
            cp = claude_path(l["city"], l["label"])
            if cp.exists():
                c = json.loads(cp.read_text())
                if c["class"] != ans["class"]:
                    changed.append((l["city"], l["label"], ans["class"], c["class"], l["records"]))
                entry.update({"class": c["class"], "source": "claude", "jev_class": ans["class"],
                              "claude_reason": c["reason"], "model": c["model"]})
            else:
                entry["source"] = "pending_claude"
                pending += 1
        out[f"{l['city']}|{l['label']}"] = entry
    CLASSES_FILE.write_text(json.dumps(out, indent=1))

    print(f"  input tokens across all labels: {tokens:,} (~${tokens / 1e6 * 0.042:.3f} at $0.042/M)")
    by_class = {}
    for v in out.values():
        by_class[v["class"]] = by_class.get(v["class"], 0) + v["records"]
    print(f"  records by class: {by_class}")
    print(f"  {len(low)} labels below confidence {LOW_CONFIDENCE} "
          f"({sum(x[4] for x in low)} records); largest:")
    for city, label, cls, conf, n in sorted(low, key=lambda x: -x[4])[:15]:
        print(f"    {city:8s} {cls:8s} {conf:.2f} {n:6d}  {label}")
    print(f"  Claude changed {len(changed)} of {len(low)} low-confidence labels "
          f"({sum(x[4] for x in changed)} records); {pending} still pending_claude. Largest changes:")
    for city, label, a, b, n in sorted(changed, key=lambda x: -x[4])[:12]:
        print(f"    {city:8s} {a:8s} -> {b:8s} {n:6d}  {label}")
    print(f"  wrote {CLASSES_FILE.name}")


if __name__ == "__main__":
    main()

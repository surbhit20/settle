"""Jev (TypeSafe AI) client for the pipeline: one "choice" question per crime label.

API (confirmed by a live call 2026.10.18, decisions.md D034):
  POST https://api.typesafe.ai/v1/systemone, header Authorization: Bearer $JEV_API_KEY
  body   {state, model, questions: {name: {type: "choice", instructions, criteria: {option: description}}}}
  answer answers[name] = {type, choice, confidence, probabilities: {option: p}}; usage = {input_tokens, output_tokens}
Pricing (third-party sources, not an official page): $0.042 per million input tokens, output free.
"""

import time

import httpx

JEV_URL = "https://api.typesafe.ai/v1/systemone"
JEV_MODEL = "jev-1.13.0"  # pinned so classifications don't drift with jev-latest

CRIME_CLASSES = {
    "violent": (
        "Harm or threat of harm to a person: homicide, assault, battery, robbery, rape or other sex "
        "crimes against a person, kidnapping, weapons used or brandished against someone, "
        "domestic violence, threats."
    ),
    "property": (
        "Taking or damaging property without force against a person: theft, shoplifting, burglary, "
        "vehicle theft or break-in, vandalism, arson, fraud, forgery, stolen property."
    ),
    "minor": (
        "Neither: traffic or parking, noise or disturbance, drugs, alcohol, warrants, trespassing, "
        "lost or found property, mental health or welfare checks, missing persons, accidents, "
        "administrative or other non-crime events."
    ),
}

CITY_NAMES = {"sf": "San Francisco", "oakland": "Oakland", "sanjose": "San Jose"}
RECORD_KIND = {"sf": "incident report description", "oakland": "crime report description", "sanjose": "call type"}


def crime_request(city: str, label: str) -> dict:
    """Request body for classifying one city's label. Pure, so it is unit tested."""
    return {
        "state": f"{CITY_NAMES[city]} police {RECORD_KIND[city]}: {label}",
        "model": JEV_MODEL,
        "questions": {
            "crime_class": {
                "type": "choice",
                "instructions": "Classify this police record into exactly one category.",
                "criteria": CRIME_CLASSES,
            }
        },
    }


def parse_crime_answer(body: dict) -> dict:
    """-> {class, confidence, probabilities, model, input_tokens}. Raises if the answer is missing."""
    ans = body["answers"]["crime_class"]
    if ans.get("choice") not in CRIME_CLASSES:
        raise ValueError(f"unexpected Jev choice: {ans.get('choice')!r}")
    return {
        "class": ans["choice"],
        "confidence": float(ans["confidence"]),
        "probabilities": ans.get("probabilities", {}),
        "model": body.get("model"),
        "input_tokens": body.get("usage", {}).get("input_tokens"),
    }


def post_with_retry(client: httpx.Client, body: dict, api_key: str, max_retries: int = 5) -> dict:
    """POST to Jev, retrying 429/529 (busy) and 5xx with backoff, honoring Retry-After."""
    for attempt in range(max_retries + 1):
        r = client.post(JEV_URL, json=body, headers={"Authorization": f"Bearer {api_key}"})
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 529) or r.status_code >= 500:
            wait = float(r.headers.get("retry-after", 2 ** attempt))
            time.sleep(min(wait, 60))
            continue
        r.raise_for_status()
    raise RuntimeError(f"Jev still busy after {max_retries} retries")

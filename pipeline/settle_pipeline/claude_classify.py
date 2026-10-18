"""Claude fallback for crime labels Jev wasn't confident about (decisions.md D034).

Same pattern as the chat router (CLAUDE.md section 6): Jev answers first; when its confidence
is below 0.7, Claude decides. One structured-output call per label, cached on disk.
"""

import json
import os

import anthropic

CLAUDE_MODEL = "claude-opus-5-5"

SYSTEM = (
    "You classify US police record labels for a neighborhood safety comparison. "
    "Answer with exactly one class:\n"
    "- violent: harm or threat of harm to a person (homicide, assault, battery, robbery, sex crimes "
    "against a person, kidnapping, weapons used or brandished against someone, domestic violence, threats).\n"
    "- property: taking or damaging property without force against a person (theft, burglary, vehicle "
    "theft or break-in, vandalism, arson, fraud, forgery, stolen property).\n"
    "- minor: anything else, including deaths of unknown or natural cause, coroner cases, weapon or "
    "ammunition possession without a victim, court-order violations, traffic offenses other than "
    "injury hit-and-run, drugs, warrants, administrative and non-crime events.\n"
    "Injury or felony hit-and-run counts as violent."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "crime_class": {"type": "string", "enum": ["violent", "property", "minor"]},
        "reason": {"type": "string"},
    },
    "required": ["crime_class", "reason"],
    "additionalProperties": False,
}


def make_client() -> anthropic.Anthropic:
    """Anthropic client from .env.local. Keys not scoped to a workspace must name one: set
    ANTHROPIC_WORKSPACE_ID and it is sent as the anthropic-workspace-id header."""
    workspace = os.environ.get("ANTHROPIC_WORKSPACE_ID")
    return anthropic.Anthropic(default_headers={"anthropic-workspace-id": workspace} if workspace else None)


def classify_with_claude(client: anthropic.Anthropic, city_name: str, record_kind: str, label: str) -> dict:
    """-> {class, reason, model, input_tokens, output_tokens}. Raises on refusal or bad output."""
    response = client.beta.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2000,
        # Refusal fallback: if a label like "RAPE" trips a safety decline, the API re-runs the
        # request on a fallback model it picks by refusal category, inside the same call.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        # Short classification: low effort is plenty (thinking can't be turned off on this model).
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        system=SYSTEM,
        messages=[{"role": "user", "content": f"{city_name} police {record_kind}: {label}"}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError(f"Claude refused to classify {label!r}")
    text = next(b.text for b in response.content if b.type == "text")
    parsed = json.loads(text)
    return {
        "class": parsed["crime_class"],
        "reason": parsed["reason"],
        "model": response.model,
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }

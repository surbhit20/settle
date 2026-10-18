"""Tests for the Jev and Claude crime classifiers. No network: Claude uses a fake client."""

from types import SimpleNamespace

import pytest

from settle_pipeline.claude_classify import CLAUDE_MODEL, classify_with_claude
from settle_pipeline.jev import CRIME_CLASSES, JEV_MODEL, crime_request, parse_crime_answer


# --- Jev ---------------------------------------------------------------------------------

def test_crime_request_is_one_pinned_choice_question_with_city_context():
    body = crime_request("sanjose", "PARKING VIOLATION")
    assert body["model"] == JEV_MODEL
    assert body["state"] == "San Jose police call type: PARKING VIOLATION"
    q = body["questions"]["crime_class"]
    assert q["type"] == "choice"
    assert set(q["criteria"]) == {"violent", "property", "minor"}


def test_parse_crime_answer_reads_choice_confidence_and_tokens():
    body = {
        "model": "jev-1.13.0",
        "answers": {"crime_class": {"type": "choice", "choice": "property", "confidence": 0.93,
                                    "probabilities": {"violent": 0.02, "property": 0.93, "minor": 0.05}}},
        "usage": {"input_tokens": 429, "output_tokens": 39},
    }
    out = parse_crime_answer(body)
    assert (out["class"], out["confidence"], out["input_tokens"]) == ("property", 0.93, 429)


def test_parse_crime_answer_rejects_unknown_choice_and_missing_answer():
    with pytest.raises(ValueError):
        parse_crime_answer({"answers": {"crime_class": {"choice": "felony", "confidence": 1}}})
    with pytest.raises(KeyError):
        parse_crime_answer({"answers": {}})


def test_crime_classes_are_the_three_the_aggregation_expects():
    from settle_pipeline.crime_aggregate import SEVERITY
    assert set(CRIME_CLASSES) == set(SEVERITY)


# --- Claude ------------------------------------------------------------------------------

class FakeMessages:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def fake_client(text='{"crime_class": "minor", "reason": "natural or unknown death"}', stop_reason="end_turn"):
    response = SimpleNamespace(
        stop_reason=stop_reason,
        model=CLAUDE_MODEL,
        content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(input_tokens=310, output_tokens=40),
    )
    messages = FakeMessages(response)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages)), messages


def test_classify_with_claude_parses_structured_output():
    client, messages = fake_client()
    out = classify_with_claude(client, "Oakland", "crime report description", "SC UNEXPLAINED DEATH")
    assert out["class"] == "minor" and out["reason"] and out["input_tokens"] == 310
    call = messages.calls[0]
    assert call["model"] == CLAUDE_MODEL
    assert call["output_config"]["effort"] == "low"
    assert call["output_config"]["format"]["schema"]["properties"]["crime_class"]["enum"] == ["violent", "property", "minor"]
    assert call["fallbacks"] == "default"
    assert "SC UNEXPLAINED DEATH" in call["messages"][0]["content"]


def test_classify_with_claude_raises_on_refusal():
    client, _ = fake_client(stop_reason="refusal")
    with pytest.raises(RuntimeError, match="refused"):
        classify_with_claude(client, "San Francisco", "incident report description", "X")

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import math


DEFAULT_CONFIG = {
    "model_version": "mastery-evidence-v1.0.0",
    # The provider payload shape and Stage 14 hand-off are unchanged.
    "provider_contract_version": "mastery-provider-contract-v0.9.0",
    # v1.0 product semantics: visible mastery starts at zero.
    "prior_score_pct": 0.0,
    "recency_half_life_days": 45.0,
    "difficulty_weights": {
        "EASY": 0.8,
        "MEDIUM": 1.0,
        "HARD": 1.2,
        "VERY_HARD": 1.4,
    },
    "misconception": {
        "repeat_window_days": 90.0,
        "increment": 0.15,
        "max_extra": 0.45,
    },
    "confidence": {
        "evidence_scale": 12.0,
        "stability_floor": 0.75,
        "stability_share": 0.25,
        "max": 0.99,
    },
    "stability": {
        "min_evidence_count": 4,
        "recent_answer_count": 5,
        "full_divergence_pct_points": 40.0,
    },
    "thresholds": {
        "weak_below": 55.0,
        "strong_at_or_above": 80.0,
        "min_confidence_for_label": 0.45,
    },
}


def clamp(x, a, b):
    return max(a, min(b, x))


def dt(x):
    y = (
        x
        if isinstance(x, datetime)
        else datetime.fromisoformat(str(x).replace("Z", "+00:00"))
    )
    return y if y.tzinfo else y.replace(tzinfo=timezone.utc)


def validate_config(c):
    if not c.get("model_version") or c["recency_half_life_days"] <= 0:
        raise ValueError("INVALID_CONFIG")

    prior = float(c.get("prior_score_pct", 0.0))
    if not 0 <= prior <= 100:
        raise ValueError("INVALID_PRIOR_SCORE")

    if set(c["difficulty_weights"]) != {"EASY", "MEDIUM", "HARD", "VERY_HARD"}:
        raise ValueError("INVALID_DIFFICULTY_CONFIG")
    if any(v <= 0 for v in c["difficulty_weights"].values()):
        raise ValueError("INVALID_DIFFICULTY_CONFIG")

    t = c["thresholds"]
    if not 0 <= t["weak_below"] < t["strong_at_or_above"] <= 100:
        raise ValueError("CONFIG_THRESHOLD_ORDER_INVALID")


def latest(evidence):
    """Keep only the latest answer sequence for an attempt/question pair."""
    selected = {}
    for item in evidence:
        if item.get("is_correct") is None:
            continue
        key = (item.get("attempt_id"), item.get("test_question_id"))
        sequence = int(item.get("answer_sequence", 1))
        if key not in selected or sequence > int(
            selected[key].get("answer_sequence", 1)
        ):
            selected[key] = item

    return sorted(
        selected.values(),
        key=lambda item: (
            dt(item["answered_at"]),
            str(item.get("answer_id", "")),
        ),
    )


def _mastery_band(mastery, confidence, evidence_count, config):
    if evidence_count <= 0:
        return "NO_EVIDENCE"

    thresholds = config["thresholds"]
    if confidence < thresholds["min_confidence_for_label"]:
        return "UNCERTAIN"
    if mastery < thresholds["weak_below"]:
        return "WEAK"
    if mastery >= thresholds["strong_at_or_above"]:
        return "STRONG"
    return "DEVELOPING"


def compute_subtopic_mastery(evidence, as_of, config=None):
    c = config or DEFAULT_CONFIG
    validate_config(c)

    items = latest(evidence)
    prior = float(c["prior_score_pct"])

    if not items:
        # With the v1.0 default prior this is exactly zero.  NO_EVIDENCE keeps
        # "not practised yet" semantically distinct from proven weakness.
        return {
            "evidence_score_pct": prior,
            "mastery_score_pct": prior,
            "confidence": 0.0,
            "evidence_count": 0,
            "effective_evidence": 0.0,
            "stability": 0.5,
            "coverage_ratio": 0.0,
            "mastery_band": "NO_EVIDENCE",
            "last_evidence_at": None,
            "model_version": c["model_version"],
            "details": [],
        }

    history = defaultdict(list)
    numerator = 0.0
    denominator = 0.0
    effective_evidence = 0.0
    correct_effective_evidence = 0.0
    details = []
    as_of_value = dt(as_of)

    for item in items:
        difficulty = str(item["difficulty_code"]).upper()
        if difficulty not in c["difficulty_weights"]:
            raise ValueError("UNKNOWN_DIFFICULTY:" + difficulty)

        answered_at = dt(item["answered_at"])
        age_days = max(
            0.0,
            (as_of_value - answered_at).total_seconds() / 86400,
        )
        recency_weight = 2 ** (
            -age_days / c["recency_half_life_days"]
        )
        difficulty_weight = c["difficulty_weights"][difficulty]
        base_weight = recency_weight * difficulty_weight

        misconception_multiplier = 1.0
        misconception_id = item.get("misconception_id")
        if not item["is_correct"] and misconception_id:
            cutoff = answered_at - timedelta(
                days=c["misconception"]["repeat_window_days"]
            )
            previous = [
                occurred_at
                for occurred_at in history[str(misconception_id)]
                if occurred_at >= cutoff
            ]
            misconception_multiplier = 1 + min(
                c["misconception"]["max_extra"],
                c["misconception"]["increment"] * len(previous),
            )
            history[str(misconception_id)].append(answered_at)

        score_weight = base_weight * misconception_multiplier
        numerator += score_weight * (1 if item["is_correct"] else 0)
        denominator += score_weight
        # Confidence intentionally excludes the misconception multiplier.
        effective_evidence += base_weight
        if item["is_correct"]:
            # Visible mastery progression is driven only by successful
            # evidence. A wrong answer therefore cannot raise the
            # progression factor merely by increasing sample size.
            correct_effective_evidence += base_weight

        details.append(
            {
                "answer_id": item.get("answer_id"),
                "is_correct": bool(item["is_correct"]),
                "difficulty_code": difficulty,
                "score_weight": score_weight,
                "base_weight": base_weight,
                "misconception_id": misconception_id,
                "misconception_multiplier": misconception_multiplier,
                "response_ms": item.get("response_ms"),
                "response_time_applied_to_score": False,
            }
        )

    evidence_score = (
        100 * numerator / denominator if denominator else prior
    )

    if len(details) < c["stability"]["min_evidence_count"]:
        stability = 0.5
    else:
        recent = details[-c["stability"]["recent_answer_count"] :]
        recent_denominator = sum(
            item["score_weight"] for item in recent
        )
        recent_numerator = sum(
            item["score_weight"] * (1 if item["is_correct"] else 0)
            for item in recent
        )
        recent_score = (
            100 * recent_numerator / recent_denominator
            if recent_denominator
            else evidence_score
        )
        stability = 1 - clamp(
            abs(recent_score - evidence_score)
            / c["stability"]["full_divergence_pct_points"],
            0,
            1,
        )

    sample_confidence = 1 - math.exp(
        -effective_evidence / c["confidence"]["evidence_scale"]
    )
    confidence = clamp(
        sample_confidence
        * (
            c["confidence"]["stability_floor"]
            + c["confidence"]["stability_share"] * stability
        ),
        0,
        c["confidence"]["max"],
    )

    # v1.0 zero-origin behaviour.
    #
    # Do NOT multiply the visible score by epistemic confidence directly.
    # Confidence can rise when a wrong answer adds information, which can
    # otherwise make mastery rise after a wrong answer.  Instead, the visible
    # progression factor grows only from successful effective evidence.
    #
    # This gives the product invariant requested for the learning UI:
    #   - a new correct answer raises mastery;
    #   - a new wrong answer lowers mastery (unless already at the 0 floor);
    # while confidence remains a separate measure of how trustworthy the
    # estimate is.
    positive_exposure = 1 - math.exp(
        -correct_effective_evidence / c["confidence"]["evidence_scale"]
    )
    positive_exposure = clamp(
        positive_exposure,
        0,
        c["confidence"]["max"],
    )
    mastery = prior + positive_exposure * (evidence_score - prior)

    band = _mastery_band(
        mastery,
        confidence,
        len(details),
        c,
    )

    return {
        "evidence_score_pct": round(evidence_score, 6),
        "mastery_score_pct": round(mastery, 6),
        "confidence": round(confidence, 9),
        "evidence_count": len(details),
        "effective_evidence": round(effective_evidence, 9),
        "stability": round(stability, 9),
        "coverage_ratio": 1.0,
        "mastery_band": band,
        "last_evidence_at": dt(items[-1]["answered_at"]).isoformat(),
        "model_version": c["model_version"],
        "details": details,
    }


def aggregate_mastery(children, weights=None, config=None):
    c = config or DEFAULT_CONFIG
    validate_config(c)
    prior = float(c["prior_score_pct"])

    weight_values = list(weights or [1.0] * len(children))
    if len(weight_values) != len(children):
        raise ValueError("WEIGHT_COUNT_MISMATCH")
    if any(float(weight) < 0 for weight in weight_values):
        raise ValueError("INVALID_AGGREGATION_WEIGHT")

    if not children:
        return {
            "evidence_score_pct": prior,
            "mastery_score_pct": prior,
            "confidence": 0.0,
            "evidence_count": 0,
            "effective_evidence": 0.0,
            "stability": 0.5,
            "coverage_ratio": 0.0,
            "mastery_band": "NO_EVIDENCE",
            "model_version": c["model_version"],
        }

    total_weight = sum(weight_values)
    if total_weight <= 0:
        raise ValueError("INVALID_AGGREGATION_WEIGHT")

    observed = [
        (child, weight)
        for child, weight in zip(children, weight_values)
        if int(child.get("evidence_count", 0)) > 0
    ]
    observed_weight = sum(weight for _, weight in observed)

    evidence_score = (
        sum(
            child["evidence_score_pct"] * weight
            for child, weight in observed
        )
        / observed_weight
        if observed_weight > 0
        else prior
    )

    confidence = (
        sum(
            float(child.get("confidence", 0)) * weight
            for child, weight in zip(children, weight_values)
        )
        / total_weight
    )
    coverage = (
        sum(
            (1 if child.get("evidence_count", 0) > 0 else 0) * weight
            for child, weight in zip(children, weight_values)
        )
        / total_weight
    )
    stability = (
        sum(
            float(child.get("stability", 0.5)) * weight
            for child, weight in zip(children, weight_values)
        )
        / total_weight
    )

    mastery = prior + confidence * (evidence_score - prior)
    evidence_count = sum(
        int(child.get("evidence_count", 0)) for child in children
    )
    effective_evidence = sum(
        float(child.get("effective_evidence", 0)) for child in children
    )
    band = _mastery_band(
        mastery,
        confidence,
        evidence_count,
        c,
    )

    return {
        "evidence_score_pct": round(evidence_score, 6),
        "mastery_score_pct": round(mastery, 6),
        "confidence": round(confidence, 9),
        "evidence_count": evidence_count,
        "effective_evidence": round(effective_evidence, 9),
        "stability": round(stability, 9),
        "coverage_ratio": round(coverage, 9),
        "mastery_band": band,
        "model_version": c["model_version"],
    }


def stage14_provider_payload(result):
    # Stage 14 deliberately receives raw Stage 15 evidence + confidence so it
    # does not apply confidence shrinkage twice. This contract is unchanged.
    return {
        "mastery_score_pct": result["evidence_score_pct"],
        "confidence": result["confidence"],
        "source": "STAGE15_EVIDENCE_SCORE",
        "stage15_final_mastery_score_pct": result["mastery_score_pct"],
        "mastery_model_version": result.get(
            "model_version",
            DEFAULT_CONFIG["model_version"],
        ),
        "provider_contract_version": DEFAULT_CONFIG[
            "provider_contract_version"
        ],
    }

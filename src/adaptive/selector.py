from __future__ import annotations

import hashlib
import math
from collections import Counter
from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional

SCORE_MODEL_VERSION = "adaptive-score-v0.9.0"
SELECTOR_VERSION = "adaptive-selector-v0.9.1"
CONFIG_SCHEMA_VERSION = "adaptive-selection-config-v0.9.0"
SIGNAL_CONTRACT_VERSION = "adaptive-signal-contract-v0.9.0"
COOLDOWN_VERSION = "adaptive-cooldown-v0.9.0"
EXPLORATION_VERSION = "adaptive-exploration-v0.9.1"
DIVERSITY_VERSION = "adaptive-diversity-v0.9.0"
DEBUG_VERSION = "adaptive-debug-metrics-v0.9.0"

DIFFICULTY_NORM = {
    "EASY": 0.0,
    "MEDIUM": 1.0 / 3.0,
    "HARD": 2.0 / 3.0,
    "VERY_HARD": 1.0,
}

DEFAULT_CONFIG: Dict[str, Any] = {
    "schema_version": CONFIG_SCHEMA_VERSION,
    "mode": "adaptive",
    "question_count": 10,
    "weights": {
        "tcf": 0.20,
        "mastery_gap": 0.30,
        "review_urgency": 0.20,
        "novelty": 0.15,
        "misconception_need": 0.15,
    },
    "normalization": {
        "tcf_max_weight_pct": 2.48,
        "mastery_prior_gap": 0.50,
        "review_overdue_full_days": 14.0,
        "novelty_full_days": 14.0,
        "misconception_repeat_full_count": 3.0,
    },
    "cooldown": {
        "days": 7,
        "allow_recent_if_shortage": False,
    },
    "exploration": {
        "share": 0.15,
    },
    "diversity": {
        "max_lesson_share": 0.35,
        "max_type_share": 0.40,
        "strict": True,
    },
    "difficulty": {
        "fit_floor": 0.75,
        "weak_gap_threshold": 0.70,
        "weak_max_difficulty": "MEDIUM",
        "developing_gap_threshold": 0.45,
        "developing_max_difficulty": "HARD",
    },
    "seed": "stage14-reference-seed-v0.9",
}


class AdaptiveSelectionError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        detail: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.code = code
        self.detail = detail or {}


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, float(value)))


def _hash_hex(seed: str, *parts: Any) -> str:
    payload = "|".join([str(seed), *[str(part) for part in parts]])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _round_half_up(value: float) -> int:
    return int(math.floor(float(value) + 0.5))


def _cap_count(total: int, share: float) -> int:
    if total <= 0:
        return 0
    return max(1, int(math.ceil(total * float(share))))


def _type_code(candidate: Dict[str, Any]) -> str | None:
    value = candidate.get("question_type_code", candidate.get("type_code"))
    return None if value is None else str(value)


def _logical_uid(candidate: Dict[str, Any]) -> str | None:
    # Runtime candidates always have question_uid. The revision fallback keeps the
    # historical lightweight reference tests backward compatible without weakening
    # production no-repeat behavior.
    value = candidate.get("question_uid", candidate.get("question_revision_id"))
    return None if value is None else str(value)


def validate_config(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cfg = deepcopy(DEFAULT_CONFIG)
    for key, value in (config or {}).items():
        if key in {
            "weights",
            "normalization",
            "cooldown",
            "exploration",
            "diversity",
            "difficulty",
        }:
            cfg[key].update(value)
        else:
            cfg[key] = value

    if cfg.get("schema_version") != CONFIG_SCHEMA_VERSION:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "Unsupported adaptive config schema_version.",
        )
    if cfg.get("mode") != "adaptive":
        if cfg.get("mode") == "review":
            raise AdaptiveSelectionError(
                "MODE_DEFERRED_STAGE16",
                "Review selection belongs to Stage16.",
            )
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "Stage14 selector supports mode=adaptive only.",
        )

    question_count = cfg.get("question_count")
    if not isinstance(question_count, int) or question_count < 1:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "question_count must be an integer >= 1.",
        )

    weights = cfg["weights"]
    required = {
        "tcf",
        "mastery_gap",
        "review_urgency",
        "novelty",
        "misconception_need",
    }
    if set(weights) != required:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "Exactly five roadmap score weights are required.",
        )
    if any(float(value) < 0 for value in weights.values()) or abs(
        sum(float(value) for value in weights.values()) - 1.0
    ) > 1e-9:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "Adaptive weights must be non-negative and sum exactly to 1.",
        )

    normalization = cfg["normalization"]
    if normalization["tcf_max_weight_pct"] <= 0:
        raise AdaptiveSelectionError("CONFIG_INVALID", "tcf_max_weight_pct must be > 0.")
    if (
        normalization["review_overdue_full_days"] <= 0
        or normalization["novelty_full_days"] <= 0
    ):
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "Normalization horizons must be > 0.",
        )
    if normalization["misconception_repeat_full_count"] <= 0:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "misconception_repeat_full_count must be > 0.",
        )

    if not 0 <= float(cfg["exploration"]["share"]) <= 1:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "exploration.share must be within 0..1.",
        )
    for key in ("max_lesson_share", "max_type_share"):
        if not 0 < float(cfg["diversity"][key]) <= 1:
            raise AdaptiveSelectionError(
                "CONFIG_INVALID",
                f"diversity.{key} must be within (0,1].",
            )

    if not 0 <= float(cfg["difficulty"]["fit_floor"]) <= 1:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "difficulty.fit_floor must be within 0..1.",
        )
    for key in ("weak_gap_threshold", "developing_gap_threshold"):
        if not 0 <= float(cfg["difficulty"][key]) <= 1:
            raise AdaptiveSelectionError(
                "CONFIG_INVALID",
                f"difficulty.{key} must be within 0..1.",
            )
    if float(cfg["difficulty"]["weak_gap_threshold"]) < float(
        cfg["difficulty"]["developing_gap_threshold"]
    ):
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "weak_gap_threshold must be >= developing_gap_threshold.",
        )
    for key in ("weak_max_difficulty", "developing_max_difficulty"):
        if cfg["difficulty"][key] not in DIFFICULTY_NORM:
            raise AdaptiveSelectionError(
                "CONFIG_INVALID",
                f"difficulty.{key} must be a controlled difficulty.",
            )

    if int(cfg["cooldown"]["days"]) < 0:
        raise AdaptiveSelectionError("CONFIG_INVALID", "cooldown.days must be >= 0.")
    if not isinstance(cfg.get("seed"), str) or not cfg["seed"]:
        raise AdaptiveSelectionError("CONFIG_INVALID", "seed must be a non-empty string.")
    return cfg


def stage13_eligible(candidate: Dict[str, Any]) -> bool:
    """Preserve Stage13 hard gates. Stage14 only ranks the already-safe pool."""
    if candidate.get("status") != "PUBLISHED":
        return False
    if not candidate.get("is_current_revision", True):
        return False
    if not candidate.get("serving_enabled", True):
        return False
    if not candidate.get("in_scope", True):
        return False
    compatibility = candidate.get("compatibility_status", "ALLOWED")
    if compatibility == "NOT_SUITABLE":
        return False
    if compatibility == "CONDITIONAL" and not candidate.get(
        "conditional_guardrail_passed", False
    ):
        return False
    if compatibility not in {"PREFERRED", "ALLOWED", "CONDITIONAL"}:
        return False
    if candidate.get("blocked_not_scorable", False):
        return False
    return True


def score_candidate(
    candidate: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    cfg = validate_config(config or {})
    norm = cfg["normalization"]
    weights = cfg["weights"]

    tcf = _clamp(
        float(candidate.get("tcf_weight_pct", 0.0)) / float(norm["tcf_max_weight_pct"])
    )

    if "mastery_gap_input" in candidate:
        raw_gap = _clamp(candidate["mastery_gap_input"])
        mastery_source = "NORMALIZED_SIGNAL_INPUT"
        confidence = _clamp(candidate.get("mastery_confidence", 1.0))
    elif "mastery_score_pct" in candidate:
        raw_gap = 1.0 - _clamp(float(candidate["mastery_score_pct"]) / 100.0)
        mastery_source = "STAGE15_COMPATIBLE_SCORE_INPUT"
        confidence = _clamp(candidate.get("mastery_confidence", 0.0))
    else:
        raw_gap = float(norm["mastery_prior_gap"])
        mastery_source = "NEUTRAL_PRIOR_NO_STAGE15_SIGNAL"
        confidence = 0.0

    prior_gap = _clamp(norm["mastery_prior_gap"])
    mastery_gap = _clamp(confidence * raw_gap + (1.0 - confidence) * prior_gap)

    if "review_urgency_input" in candidate:
        review_urgency = _clamp(candidate["review_urgency_input"])
        review_source = candidate.get(
            "review_urgency_source", "NORMALIZED_SIGNAL_INPUT"
        )
    else:
        overdue = max(0.0, float(candidate.get("days_overdue", 0.0)))
        review_urgency = _clamp(overdue / float(norm["review_overdue_full_days"]))
        review_source = "DAYS_OVERDUE"

    seen = candidate.get("days_since_seen")
    novelty = (
        1.0
        if seen is None
        else _clamp(max(0.0, float(seen)) / float(norm["novelty_full_days"]))
    )

    repeats = max(0.0, float(candidate.get("misconception_repeat_count", 0.0)))
    misconception_need = _clamp(
        repeats / float(norm["misconception_repeat_full_count"])
    )

    components = {
        "tcf": tcf,
        "mastery_gap": mastery_gap,
        "review_urgency": review_urgency,
        "novelty": novelty,
        "misconception_need": misconception_need,
    }
    base = sum(float(weights[key]) * components[key] for key in components)

    difficulty = candidate.get("difficulty", "MEDIUM")
    if difficulty not in DIFFICULTY_NORM:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            f"Unknown difficulty: {difficulty}",
        )
    readiness = _clamp(1.0 - mastery_gap)
    difficulty_fit = _clamp(1.0 - abs(DIFFICULTY_NORM[difficulty] - readiness))
    fit_floor = float(cfg["difficulty"]["fit_floor"])
    difficulty_multiplier = fit_floor + (1.0 - fit_floor) * difficulty_fit
    adjusted = base * difficulty_multiplier

    if mastery_gap >= float(cfg["difficulty"]["weak_gap_threshold"]):
        max_difficulty = cfg["difficulty"]["weak_max_difficulty"]
    elif mastery_gap >= float(cfg["difficulty"]["developing_gap_threshold"]):
        max_difficulty = cfg["difficulty"]["developing_max_difficulty"]
    else:
        max_difficulty = "VERY_HARD"
    difficulty_guardrail_pass = (
        DIFFICULTY_NORM[difficulty] <= DIFFICULTY_NORM[max_difficulty] + 1e-12
    )

    return {
        "components": components,
        "base_score": base,
        "mastery_raw_gap": raw_gap,
        "mastery_confidence": confidence,
        "mastery_source": mastery_source,
        "review_source": review_source,
        "readiness": readiness,
        "difficulty_fit": difficulty_fit,
        "difficulty_multiplier": difficulty_multiplier,
        "difficulty_max_allowed": max_difficulty,
        "difficulty_guardrail_pass": difficulty_guardrail_pass,
        "adjusted_score": adjusted,
        "versions": {
            "selector": SELECTOR_VERSION,
            "score_model": SCORE_MODEL_VERSION,
            "signal_contract": SIGNAL_CONTRACT_VERSION,
            "cooldown": COOLDOWN_VERSION,
            "exploration": EXPLORATION_VERSION,
            "diversity": DIVERSITY_VERSION,
            "debug": DEBUG_VERSION,
        },
    }


def exploration_slots(n: int, share: float, seed: str) -> List[int]:
    if n <= 0 or share <= 0:
        return []
    count = min(n, _round_half_up(n * share))
    if n >= 5 and count == 0:
        count = 1
    ranked = sorted(range(n), key=lambda index: _hash_hex(seed, "explore-slot", index))
    return sorted(ranked[:count])


def _is_recent(candidate: Dict[str, Any], cooldown_days: int) -> bool:
    seen = candidate.get("days_since_seen")
    return seen is not None and float(seen) < float(cooldown_days)


def select_adaptive(
    config: Dict[str, Any],
    candidates: Iterable[Dict[str, Any]],
) -> Dict[str, Any]:
    """Select adaptive questions using real EXPLORE/EXPLOIT slots.

    EXPLORE membership is chosen by an independent seed hash and does not use the
    adaptive score for candidate ranking. All Stage13 gates, difficulty pacing,
    cooldown, lesson/type caps and logical no-repeat rules still apply.
    """
    cfg = validate_config(config)
    n = cfg["question_count"]
    raw = [deepcopy(candidate) for candidate in candidates]
    eligible = [candidate for candidate in raw if stage13_eligible(candidate)]
    if not eligible:
        raise AdaptiveSelectionError(
            "NO_ELIGIBLE_QUESTIONS",
            "No Stage13-eligible Published serving candidate exists.",
            {"raw_candidates": len(raw), "eligible_candidates": 0},
        )

    for candidate in eligible:
        revision_id = candidate.get("question_revision_id")
        lesson_id = candidate.get("lesson_id")
        type_code = _type_code(candidate)
        logical_uid = _logical_uid(candidate)
        if not revision_id or not lesson_id or not type_code or not logical_uid:
            raise AdaptiveSelectionError(
                "ADAPTIVE_SIGNAL_INSUFFICIENT",
                "Candidate identity fields are incomplete.",
            )
        candidate["_type_code"] = type_code
        candidate["_logical_uid"] = logical_uid
        candidate["_score"] = score_candidate(candidate, cfg)

    cooldown_days = int(cfg["cooldown"]["days"])
    difficulty_safe = [
        candidate
        for candidate in eligible
        if candidate["_score"]["difficulty_guardrail_pass"]
    ]
    difficulty_blocked = [
        candidate
        for candidate in eligible
        if not candidate["_score"]["difficulty_guardrail_pass"]
    ]
    cool = [
        candidate
        for candidate in difficulty_safe
        if not _is_recent(candidate, cooldown_days)
    ]
    recent = [
        candidate
        for candidate in difficulty_safe
        if _is_recent(candidate, cooldown_days)
    ]
    allow_recent = bool(cfg["cooldown"]["allow_recent_if_shortage"])

    lesson_cap = _cap_count(n, cfg["diversity"]["max_lesson_share"])
    type_cap = _cap_count(n, cfg["diversity"]["max_type_share"])
    explore_positions = set(exploration_slots(n, cfg["exploration"]["share"], cfg["seed"]))

    selected: List[Dict[str, Any]] = []
    lesson_counts: Counter = Counter()
    type_counts: Counter = Counter()
    selected_uids: set[str] = set()
    used_revision_ids: set[str] = set()

    def cap_ok(candidate: Dict[str, Any]) -> bool:
        return (
            lesson_counts[str(candidate["lesson_id"])] < lesson_cap
            and type_counts[candidate["_type_code"]] < type_cap
            and candidate["_logical_uid"] not in selected_uids
            and str(candidate["question_revision_id"]) not in used_revision_ids
        )

    for position in range(n):
        pool = [candidate for candidate in cool if cap_ok(candidate)]
        cooldown_relaxed = False
        if not pool and allow_recent:
            pool = [candidate for candidate in recent if cap_ok(candidate)]
            cooldown_relaxed = bool(pool)

        if not pool:
            uncapped = [
                candidate
                for candidate in (cool + (recent if allow_recent else []))
                if candidate["_logical_uid"] not in selected_uids
                and str(candidate["question_revision_id"]) not in used_revision_ids
            ]
            if uncapped and cfg["diversity"].get("strict", True):
                code = "DIVERSITY_CAP_INFEASIBLE"
                message = (
                    "Strict per-lesson/per-type diversity caps prevent filling "
                    "the requested test."
                )
            else:
                code = "INSUFFICIENT_ELIGIBLE_INVENTORY"
                message = "Not enough eligible candidates after cooldown and no-repeat rules."
            raise AdaptiveSelectionError(
                code,
                message,
                {
                    "requested_count": n,
                    "selected_count": len(selected),
                    "eligible": len(eligible),
                    "difficulty_safe": len(difficulty_safe),
                    "difficulty_blocked": len(difficulty_blocked),
                    "after_cooldown": len(cool),
                    "recent_candidates": len(recent),
                    "allow_recent_if_shortage": allow_recent,
                    "lesson_cap_count": lesson_cap,
                    "type_cap_count": type_cap,
                },
            )

        is_explore = position in explore_positions
        if is_explore:
            chosen = min(
                pool,
                key=lambda candidate: _hash_hex(
                    cfg["seed"],
                    "explore-candidate",
                    position,
                    candidate["question_revision_id"],
                ),
            )
            reason = "EXPLORE"
        else:
            chosen = sorted(
                pool,
                key=lambda candidate: (
                    -candidate["_score"]["adjusted_score"],
                    _hash_hex(
                        cfg["seed"],
                        "exploit-tie",
                        position,
                        candidate["question_revision_id"],
                    ),
                ),
            )[0]
            reason = "EXPLOIT"

        lesson_id = str(chosen["lesson_id"])
        type_code = chosen["_type_code"]
        logical_uid = chosen["_logical_uid"]
        revision_id = str(chosen["question_revision_id"])
        rank_digest = _hash_hex(
            cfg["seed"],
            "rank",
            position,
            revision_id,
            f'{chosen["_score"]["adjusted_score"]:.12f}',
            reason,
        )
        score_detail = deepcopy(chosen["_score"])
        meta = {
            "position": position + 1,
            "selection_reason": reason,
            "cooldown_relaxed": cooldown_relaxed,
            "lesson_cap_count": lesson_cap,
            "type_cap_count": type_cap,
            "lesson_count_before": lesson_counts[lesson_id],
            "type_count_before": type_counts[type_code],
            "rank_digest": rank_digest,
            # Keep the current runtime persistence adapter compatible: it reads
            # selection_meta.score.adjusted_score into test_questions.selection_score.
            "score": score_detail,
            "selector_version": SELECTOR_VERSION,
            # Also preserve the canonical Stage14 flat debug fields for auditability.
            **score_detail,
        }

        item = {
            key: deepcopy(value)
            for key, value in chosen.items()
            if not key.startswith("_") and key != "selection_meta"
        }
        item["selection_meta"] = meta
        selected.append(item)

        lesson_counts[lesson_id] += 1
        type_counts[type_code] += 1
        selected_uids.add(logical_uid)
        used_revision_ids.add(revision_id)
        cool = [
            candidate
            for candidate in cool
            if str(candidate["question_revision_id"]) != revision_id
        ]
        recent = [
            candidate
            for candidate in recent
            if str(candidate["question_revision_id"]) != revision_id
        ]

    digest_payload = "|".join(
        f'{item["question_revision_id"]}:{item["selection_meta"]["selection_reason"]}:'
        f'{item["selection_meta"]["rank_digest"]}'
        for item in selected
    )
    selection_digest = hashlib.sha256(digest_payload.encode("utf-8")).hexdigest()

    return {
        "selector_version": SELECTOR_VERSION,
        "score_model_version": SCORE_MODEL_VERSION,
        "config_schema_version": CONFIG_SCHEMA_VERSION,
        "selected_count": len(selected),
        "exploration_positions_1based": [
            index + 1 for index in sorted(explore_positions)
        ],
        "exploration_count": sum(
            1
            for item in selected
            if item["selection_meta"]["selection_reason"] == "EXPLORE"
        ),
        "lesson_cap_count": lesson_cap,
        "type_cap_count": type_cap,
        "selection_digest": selection_digest,
        "selected": selected,
        "resolved_config": cfg,
        "runtime_boundary": {
            "stage13": "eligibility/snapshot/quota safety remains authoritative",
            "stage15": (
                "provides mastery_score/confidence; Stage14 does not compute mastery "
                "from raw answers"
            ),
            "stage16": "owns review-mode/error-review bypass semantics",
            "stage17": (
                "owns SRS due-date scheduling; Stage14 only consumes review urgency/due signal"
            ),
            "stage27": "owns empirical recalibration of weights/thresholds",
        },
    }

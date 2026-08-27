from __future__ import annotations

import hashlib
import math
from collections import Counter
from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional

SCORE_MODEL_VERSION = "adaptive-score-v0.9.0"
SELECTOR_VERSION = "adaptive-selector-v1.0.0"
CONFIG_SCHEMA_VERSION = "adaptive-selection-config-v0.9.0"
SIGNAL_CONTRACT_VERSION = "adaptive-signal-contract-v0.9.0"
COOLDOWN_VERSION = "adaptive-cooldown-v0.9.0"
EXPLORATION_VERSION = "adaptive-exploration-v0.9.1"
DIVERSITY_VERSION = "adaptive-diversity-v1.0.0"
BALANCE_VERSION = "adaptive-general-balance-v1.0.0"
DEBUG_VERSION = "adaptive-debug-metrics-v1.0.0"

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
    # Existing adaptive score stays intact. It is now used only inside the
    # dedicated 10% adaptive budget for a general/all-lessons practice session.
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
    # Kept for backward/debug compatibility with Stage14 artifacts. The actual
    # general-practice bucket split is authoritative in balance below.
    "exploration": {
        "share": 0.15,
    },
    "balance": {
        "coverage_share": 0.75,
        "adaptive_share": 0.10,
        "exploration_share": 0.15,
    },
    "diversity": {
        # Preserve the historical cap for narrow scopes. For broad scopes the
        # stronger cap below prevents one lesson from dominating general practice.
        "max_lesson_share": 0.35,
        "large_scope_lesson_threshold": 6,
        "large_scope_max_lesson_share": 0.20,
        "max_category_share": 0.35,
        "max_subcategory_share": 0.30,
        "max_type_share": 0.40,
        # Steering targets, not fail-fast quotas. They are used when the pool can
        # support them, and therefore do not make a legitimate narrow scope invalid.
        "min_distinct_lesson_ratio": 0.40,
        "min_distinct_category_ratio": 0.25,
        "max_same_subtopic_streak": 2,
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


def _effective_cap_count(total: int, share: float, distinct_groups: int) -> int:
    """Return a strict cap that cannot be mathematically impossible by itself."""
    if total <= 0:
        return 0
    if distinct_groups <= 1:
        return total
    configured = _cap_count(total, share)
    feasibility_floor = int(math.ceil(total / float(distinct_groups)))
    return min(total, max(configured, feasibility_floor))


def _type_code(candidate: Dict[str, Any]) -> str | None:
    value = candidate.get("question_type_code", candidate.get("type_code"))
    return None if value is None else str(value)


def _logical_uid(candidate: Dict[str, Any]) -> str | None:
    value = candidate.get("question_uid", candidate.get("question_revision_id"))
    return None if value is None else str(value)


def _optional_id(candidate: Dict[str, Any], field: str) -> str | None:
    value = candidate.get(field)
    return None if value in (None, "") else str(value)


def validate_config(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cfg = deepcopy(DEFAULT_CONFIG)
    for key, value in (config or {}).items():
        if key in {
            "weights",
            "normalization",
            "cooldown",
            "exploration",
            "balance",
            "diversity",
            "difficulty",
        }:
            if not isinstance(value, dict):
                raise AdaptiveSelectionError(
                    "CONFIG_INVALID",
                    f"{key} must be an object.",
                )
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
    if not isinstance(question_count, int) or isinstance(question_count, bool) or question_count < 1:
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

    balance = cfg["balance"]
    balance_keys = {"coverage_share", "adaptive_share", "exploration_share"}
    if set(balance) != balance_keys:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "balance must contain coverage_share, adaptive_share and exploration_share.",
        )
    if any(not 0 <= float(balance[key]) <= 1 for key in balance_keys):
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "All balance shares must be within 0..1.",
        )
    if abs(sum(float(balance[key]) for key in balance_keys) - 1.0) > 1e-9:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "General adaptive balance shares must sum exactly to 1.",
        )

    if not 0 <= float(cfg["exploration"]["share"]) <= 1:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "exploration.share must be within 0..1.",
        )

    diversity = cfg["diversity"]
    for key in (
        "max_lesson_share",
        "large_scope_max_lesson_share",
        "max_category_share",
        "max_subcategory_share",
        "max_type_share",
    ):
        if not 0 < float(diversity[key]) <= 1:
            raise AdaptiveSelectionError(
                "CONFIG_INVALID",
                f"diversity.{key} must be within (0,1].",
            )
    for key in ("min_distinct_lesson_ratio", "min_distinct_category_ratio"):
        if not 0 <= float(diversity[key]) <= 1:
            raise AdaptiveSelectionError(
                "CONFIG_INVALID",
                f"diversity.{key} must be within 0..1.",
            )
    if int(diversity["large_scope_lesson_threshold"]) < 1:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "diversity.large_scope_lesson_threshold must be >= 1.",
        )
    if int(diversity["max_same_subtopic_streak"]) < 1:
        raise AdaptiveSelectionError(
            "CONFIG_INVALID",
            "diversity.max_same_subtopic_streak must be >= 1.",
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
            "balance": BALANCE_VERSION,
            "debug": DEBUG_VERSION,
        },
    }


def exploration_slots(n: int, share: float, seed: str) -> List[int]:
    """Historical helper retained for compatibility and deterministic tests."""
    if n <= 0 or share <= 0:
        return []
    count = min(n, _round_half_up(n * share))
    if n >= 5 and count == 0:
        count = 1
    ranked = sorted(range(n), key=lambda index: _hash_hex(seed, "explore-slot", index))
    return sorted(ranked[:count])


def _apportion_buckets(n: int, balance: Dict[str, Any]) -> Dict[str, int]:
    """Largest-remainder apportionment with exploration winning exact ties.

    For the normal 20-question session this is exactly 15/2/3.
    """
    names = ("COVERAGE", "ADAPTIVE", "EXPLORATION")
    shares = {
        "COVERAGE": float(balance["coverage_share"]),
        "ADAPTIVE": float(balance["adaptive_share"]),
        "EXPLORATION": float(balance["exploration_share"]),
    }
    expected = {name: n * shares[name] for name in names}
    counts = {name: int(math.floor(expected[name])) for name in names}
    remaining = n - sum(counts.values())
    tie_priority = {"EXPLORATION": 0, "COVERAGE": 1, "ADAPTIVE": 2}
    ranked = sorted(
        names,
        key=lambda name: (
            -(expected[name] - counts[name]),
            tie_priority[name],
        ),
    )
    for name in ranked:
        if remaining <= 0:
            break
        counts[name] += 1
        remaining -= 1
    return counts


def _bucket_schedule(n: int, counts: Dict[str, int], seed: str) -> List[str]:
    """Materialize deterministic slots while retaining seed-independent quotas."""
    schedule = ["COVERAGE"] * n
    all_positions = list(range(n))

    explore_ranked = sorted(
        all_positions,
        key=lambda index: _hash_hex(seed, "explore-slot", index),
    )
    explore_positions = set(explore_ranked[: counts["EXPLORATION"]])
    for position in explore_positions:
        schedule[position] = "EXPLORATION"

    remaining_positions = [p for p in all_positions if p not in explore_positions]
    adaptive_ranked = sorted(
        remaining_positions,
        key=lambda index: _hash_hex(seed, "adaptive-slot", index),
    )
    adaptive_positions = set(adaptive_ranked[: counts["ADAPTIVE"]])
    for position in adaptive_positions:
        schedule[position] = "ADAPTIVE"

    return schedule


def _is_recent(candidate: Dict[str, Any], cooldown_days: int) -> bool:
    seen = candidate.get("days_since_seen")
    return seen is not None and float(seen) < float(cooldown_days)


def _weighted_fairness(count: int, weight: float) -> float:
    # Positive fallback guarantees deterministic fair rotation even if Stage3 TCF
    # weight is absent/zero in a synthetic or legacy fixture.
    safe_weight = max(float(weight), 1e-9)
    return (count + 1.0) / safe_weight


def select_adaptive(
    config: Dict[str, Any],
    candidates: Iterable[Dict[str, Any]],
) -> Dict[str, Any]:
    """Balanced general Adaptive selection.

    General-practice slots are explicitly divided into:
      * 75% COVERAGE: TCF-aware hierarchical coverage/diversity,
      * 10% ADAPTIVE: current weakness/review adaptive score ranking,
      * 15% EXPLORATION: independent deterministic exploration.

    Stage13 hard gates, difficulty pacing, cooldown and logical no-repeat remain
    authoritative. Diversity caps now also cover category/subcategory, and broad
    scopes use a stronger per-lesson cap.
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
                {"question_revision_id": revision_id},
            )
        candidate["question_revision_id"] = str(revision_id)
        candidate["lesson_id"] = str(lesson_id)
        candidate["_type_code"] = type_code
        candidate["_logical_uid"] = logical_uid
        candidate["_category_id"] = _optional_id(candidate, "category_id")
        candidate["_subcategory_id"] = _optional_id(candidate, "subcategory_id")
        candidate["_subtopic_id"] = _optional_id(candidate, "subtopic_id")
        candidate["_score"] = score_candidate(candidate, cfg)

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
    if not difficulty_safe:
        raise AdaptiveSelectionError(
            "INSUFFICIENT_ELIGIBLE_INVENTORY",
            "No candidate remains after adaptive difficulty pacing.",
            {
                "requested_count": n,
                "eligible": len(eligible),
                "difficulty_safe": 0,
                "difficulty_blocked": len(difficulty_blocked),
            },
        )

    cooldown_days = int(cfg["cooldown"]["days"])
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

    if len(cool) < n and not allow_recent:
        raise AdaptiveSelectionError(
            "INSUFFICIENT_ELIGIBLE_INVENTORY",
            "Not enough eligible candidates after cooldown and no-repeat rules.",
            {
                "requested_count": n,
                "eligible": len(eligible),
                "difficulty_safe": len(difficulty_safe),
                "difficulty_blocked": len(difficulty_blocked),
                "after_cooldown": len(cool),
                "recent_candidates": len(recent),
                "allow_recent_if_shortage": allow_recent,
            },
        )

    distinct_lessons = sorted({str(candidate["lesson_id"]) for candidate in difficulty_safe})
    distinct_types = sorted({candidate["_type_code"] for candidate in difficulty_safe})
    distinct_categories = sorted(
        {candidate["_category_id"] for candidate in difficulty_safe if candidate["_category_id"]}
    )
    distinct_subcategories = sorted(
        {candidate["_subcategory_id"] for candidate in difficulty_safe if candidate["_subcategory_id"]}
    )

    diversity = cfg["diversity"]
    lesson_share = (
        float(diversity["large_scope_max_lesson_share"])
        if len(distinct_lessons) >= int(diversity["large_scope_lesson_threshold"])
        else float(diversity["max_lesson_share"])
    )
    lesson_cap = _effective_cap_count(n, lesson_share, len(distinct_lessons))
    type_cap = _effective_cap_count(n, float(diversity["max_type_share"]), len(distinct_types))
    category_cap = (
        _effective_cap_count(n, float(diversity["max_category_share"]), len(distinct_categories))
        if distinct_categories
        else n
    )
    subcategory_cap = (
        _effective_cap_count(
            n,
            float(diversity["max_subcategory_share"]),
            len(distinct_subcategories),
        )
        if distinct_subcategories
        else n
    )

    min_distinct_lessons = min(
        len(distinct_lessons),
        max(1, _round_half_up(n * float(diversity["min_distinct_lesson_ratio"]))),
    )
    min_distinct_categories = (
        min(
            len(distinct_categories),
            max(1, _round_half_up(n * float(diversity["min_distinct_category_ratio"]))),
        )
        if distinct_categories
        else 0
    )

    bucket_counts = _apportion_buckets(n, cfg["balance"])
    schedule = _bucket_schedule(n, bucket_counts, cfg["seed"])

    # TCF hierarchy uses unique lessons, not candidate inventory size, so a lesson
    # with more published questions does not gain artificial coverage weight.
    lesson_weights: Dict[str, float] = {}
    lesson_category: Dict[str, str | None] = {}
    lesson_subcategory: Dict[str, str | None] = {}
    for candidate in difficulty_safe:
        lesson_id = str(candidate["lesson_id"])
        lesson_weights[lesson_id] = max(
            lesson_weights.get(lesson_id, 0.0),
            max(0.0, float(candidate.get("tcf_weight_pct", 0.0))),
        )
        lesson_category.setdefault(lesson_id, candidate["_category_id"])
        lesson_subcategory.setdefault(lesson_id, candidate["_subcategory_id"])
    if not any(weight > 0 for weight in lesson_weights.values()):
        lesson_weights = {lesson_id: 1.0 for lesson_id in lesson_weights}
    else:
        # A zero-TCF lesson remains selectable for general coverage, but with a
        # small positive floor rather than being silently starved forever.
        positive = [weight for weight in lesson_weights.values() if weight > 0]
        floor = min(positive) * 0.10 if positive else 1.0
        lesson_weights = {
            lesson_id: (weight if weight > 0 else floor)
            for lesson_id, weight in lesson_weights.items()
        }

    category_weights: Dict[str, float] = Counter()
    subcategory_weights: Dict[str, float] = Counter()
    for lesson_id, weight in lesson_weights.items():
        category_id = lesson_category.get(lesson_id)
        subcategory_id = lesson_subcategory.get(lesson_id)
        if category_id:
            category_weights[category_id] += weight
        if subcategory_id:
            subcategory_weights[subcategory_id] += weight

    selected: List[Dict[str, Any]] = []
    lesson_counts: Counter = Counter()
    type_counts: Counter = Counter()
    category_counts: Counter = Counter()
    subcategory_counts: Counter = Counter()
    subtopic_counts: Counter = Counter()
    bucket_actual_counts: Counter = Counter()
    selected_uids: set[str] = set()
    used_revision_ids: set[str] = set()
    last_subtopic: str | None = None
    same_subtopic_streak = 0

    def cap_ok(candidate: Dict[str, Any]) -> bool:
        category_id = candidate["_category_id"]
        subcategory_id = candidate["_subcategory_id"]
        return (
            lesson_counts[str(candidate["lesson_id"])] < lesson_cap
            and type_counts[candidate["_type_code"]] < type_cap
            and (category_id is None or category_counts[category_id] < category_cap)
            and (
                subcategory_id is None
                or subcategory_counts[subcategory_id] < subcategory_cap
            )
            and candidate["_logical_uid"] not in selected_uids
            and str(candidate["question_revision_id"]) not in used_revision_ids
        )

    def pacing_pool(pool: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if same_subtopic_streak < int(diversity["max_same_subtopic_streak"]):
            return pool
        if last_subtopic is None:
            return pool
        alternatives = [
            candidate
            for candidate in pool
            if candidate["_subtopic_id"] is None or candidate["_subtopic_id"] != last_subtopic
        ]
        return alternatives or pool

    def coverage_rank(candidate: Dict[str, Any], position: int) -> tuple[Any, ...]:
        lesson_id = str(candidate["lesson_id"])
        category_id = candidate["_category_id"]
        subcategory_id = candidate["_subcategory_id"]

        category_target_pending = (
            min_distinct_categories > 0
            and len(category_counts) < min_distinct_categories
        )
        lesson_target_pending = len(lesson_counts) < min_distinct_lessons

        category_new_penalty = (
            0
            if category_target_pending and category_id and category_counts[category_id] == 0
            else 1
        )
        lesson_new_penalty = (
            0
            if lesson_target_pending and lesson_counts[lesson_id] == 0
            else 1
        )

        category_fairness = (
            _weighted_fairness(category_counts[category_id], category_weights[category_id])
            if category_id and category_weights.get(category_id, 0.0) > 0
            else 0.0
        )
        subcategory_fairness = (
            _weighted_fairness(
                subcategory_counts[subcategory_id],
                subcategory_weights[subcategory_id],
            )
            if subcategory_id and subcategory_weights.get(subcategory_id, 0.0) > 0
            else 0.0
        )
        lesson_fairness = _weighted_fairness(
            lesson_counts[lesson_id],
            lesson_weights[lesson_id],
        )
        return (
            category_new_penalty,
            lesson_new_penalty,
            category_fairness,
            subcategory_fairness,
            lesson_fairness,
            type_counts[candidate["_type_code"]],
            subtopic_counts[candidate["_subtopic_id"]] if candidate["_subtopic_id"] else 0,
            _hash_hex(
                cfg["seed"],
                "coverage-candidate",
                position,
                candidate["question_revision_id"],
            ),
        )

    for position, bucket in enumerate(schedule):
        pool = [candidate for candidate in cool if cap_ok(candidate)]
        cooldown_relaxed = False
        if not pool and allow_recent:
            pool = [candidate for candidate in recent if cap_ok(candidate)]
            cooldown_relaxed = bool(pool)

        pool = pacing_pool(pool)

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
                    "Strict lesson/category/subcategory/type diversity caps prevent "
                    "filling the requested test."
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
                    "category_cap_count": category_cap,
                    "subcategory_cap_count": subcategory_cap,
                    "type_cap_count": type_cap,
                    "bucket_counts": dict(bucket_counts),
                },
            )

        if bucket == "EXPLORATION":
            chosen = min(
                pool,
                key=lambda candidate: _hash_hex(
                    cfg["seed"],
                    "explore-candidate",
                    position,
                    candidate["question_revision_id"],
                ),
            )
            selection_reason = "EXPLORE"
        elif bucket == "ADAPTIVE":
            chosen = sorted(
                pool,
                key=lambda candidate: (
                    -candidate["_score"]["adjusted_score"],
                    lesson_counts[str(candidate["lesson_id"])],
                    category_counts[candidate["_category_id"]]
                    if candidate["_category_id"]
                    else 0,
                    _hash_hex(
                        cfg["seed"],
                        "adaptive-candidate",
                        position,
                        candidate["question_revision_id"],
                    ),
                ),
            )[0]
            # Keep historical EXPLOIT vocabulary for downstream compatibility;
            # selection_bucket distinguishes the new 10% weakness budget.
            selection_reason = "EXPLOIT"
        else:
            chosen = min(pool, key=lambda candidate: coverage_rank(candidate, position))
            # Coverage is deterministic exploitation of the general/TCF policy,
            # not random exploration, so retain EXPLOIT as the legacy reason.
            selection_reason = "EXPLOIT"

        lesson_id = str(chosen["lesson_id"])
        type_code = chosen["_type_code"]
        category_id = chosen["_category_id"]
        subcategory_id = chosen["_subcategory_id"]
        subtopic_id = chosen["_subtopic_id"]
        logical_uid = chosen["_logical_uid"]
        revision_id = str(chosen["question_revision_id"])

        rank_digest = _hash_hex(
            cfg["seed"],
            "rank",
            position,
            revision_id,
            f'{chosen["_score"]["adjusted_score"]:.12f}',
            selection_reason,
            bucket,
        )
        score_detail = deepcopy(chosen["_score"])
        meta = {
            "position": position + 1,
            "selection_reason": selection_reason,
            "selection_bucket": bucket,
            "bucket_quota_count": bucket_counts[bucket],
            "cooldown_relaxed": cooldown_relaxed,
            "lesson_cap_count": lesson_cap,
            "category_cap_count": category_cap,
            "subcategory_cap_count": subcategory_cap,
            "type_cap_count": type_cap,
            "lesson_count_before": lesson_counts[lesson_id],
            "category_count_before": category_counts[category_id] if category_id else 0,
            "subcategory_count_before": (
                subcategory_counts[subcategory_id] if subcategory_id else 0
            ),
            "type_count_before": type_counts[type_code],
            "rank_digest": rank_digest,
            "score": score_detail,
            "selector_version": SELECTOR_VERSION,
            "balance_version": BALANCE_VERSION,
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
        if category_id:
            category_counts[category_id] += 1
        if subcategory_id:
            subcategory_counts[subcategory_id] += 1
        if subtopic_id:
            subtopic_counts[subtopic_id] += 1
        bucket_actual_counts[bucket] += 1
        selected_uids.add(logical_uid)
        used_revision_ids.add(revision_id)

        if subtopic_id is not None and subtopic_id == last_subtopic:
            same_subtopic_streak += 1
        else:
            last_subtopic = subtopic_id
            same_subtopic_streak = 1 if subtopic_id is not None else 0

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
        f'{item["question_revision_id"]}:'
        f'{item["selection_meta"]["selection_reason"]}:'
        f'{item["selection_meta"]["selection_bucket"]}:'
        f'{item["selection_meta"]["rank_digest"]}'
        for item in selected
    )
    selection_digest = hashlib.sha256(digest_payload.encode("utf-8")).hexdigest()

    exploration_positions = [
        index + 1
        for index, bucket in enumerate(schedule)
        if bucket == "EXPLORATION"
    ]

    return {
        "selector_version": SELECTOR_VERSION,
        "score_model_version": SCORE_MODEL_VERSION,
        "config_schema_version": CONFIG_SCHEMA_VERSION,
        "balance_version": BALANCE_VERSION,
        "selected_count": len(selected),
        "selection_bucket_quota": dict(bucket_counts),
        "selection_bucket_counts": {
            name: int(bucket_actual_counts[name])
            for name in ("COVERAGE", "ADAPTIVE", "EXPLORATION")
        },
        "exploration_positions_1based": exploration_positions,
        "exploration_count": int(bucket_actual_counts["EXPLORATION"]),
        "lesson_cap_count": lesson_cap,
        "category_cap_count": category_cap,
        "subcategory_cap_count": subcategory_cap,
        "type_cap_count": type_cap,
        "minimum_distinct_lesson_target": min_distinct_lessons,
        "minimum_distinct_category_target": min_distinct_categories,
        "actual_distinct_lessons": len(lesson_counts),
        "actual_distinct_categories": len(category_counts),
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

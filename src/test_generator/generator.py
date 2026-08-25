from __future__ import annotations

import hashlib
import math
import secrets
from collections import defaultdict, deque
from typing import Any, Mapping, Sequence

GENERATOR_VERSION = "test-generator-v0.9.1"
CONFIG_SCHEMA_VERSION = "test-config-schema-v0.9.0"
QUOTA_POLICY_VERSION = "test-quota-policy-v0.9.1"
DIFFICULTIES = ("EASY", "MEDIUM", "HARD", "VERY_HARD")
ADJACENT = {
    "EASY": ["MEDIUM"],
    "MEDIUM": ["EASY", "HARD"],
    "HARD": ["MEDIUM", "VERY_HARD"],
    "VERY_HARD": ["HARD"],
}


class GeneratorError(Exception):
    def __init__(self, code: str, message: str, detail: Mapping[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.detail = dict(detail or {})


def _digest(*parts: Any) -> str:
    return hashlib.sha256("|".join(map(str, parts)).encode("utf-8")).hexdigest()


def _unit_interval(seed: str, stream: str, key: Any) -> float:
    """Deterministic pseudo-random value strictly inside (0, 1)."""
    raw = int(_digest(seed, stream, key), 16)
    denominator = (1 << 256) + 1
    return (raw + 1) / denominator


def largest_remainder(
    total: int,
    weights: Mapping[Any, float],
    stable_order: Sequence[Any] | None = None,
) -> dict[Any, int]:
    """Classic Hamilton allocation with stable-id tie-break.

    Kept unchanged for difficulty/type quotas and for backward-compatible callers.
    Lesson allocation uses seeded_stochastic_remainder() below so equal or near-equal
    residual seats do not repeatedly favor lexicographically early lesson UUIDs.
    """
    if total < 0:
        raise ValueError("total must be non-negative")
    keys = list(stable_order or sorted(weights))
    vals = {key: float(weights.get(key, 0)) for key in keys}
    if any(value < 0 for value in vals.values()):
        raise ValueError("negative weight")
    weight_sum = sum(vals.values())
    if total and weight_sum <= 0:
        raise ValueError("positive weight required")
    if total == 0:
        return {key: 0 for key in keys}

    expected = {key: total * vals[key] / weight_sum for key in keys}
    out = {key: int(math.floor(expected[key])) for key in keys}
    residual = total - sum(out.values())
    ranked = sorted(keys, key=lambda key: (-(expected[key] - out[key]), str(key)))
    for key in ranked[:residual]:
        out[key] += 1
    return out


def seeded_stochastic_remainder(
    total: int,
    weights: Mapping[Any, float],
    *,
    seed: str,
    stream: str,
    stable_order: Sequence[Any] | None = None,
) -> dict[Any, int]:
    """Hamilton floors + deterministic weighted sampling for residual seats.

    The floor part remains exact. Residual seats are sampled without replacement
    from fractional remainders using a deterministic exponential race derived from
    the persisted seed. This preserves exact totals, reproducibility and long-run
    proportionality while removing stable-ID remainder bias.

    For UNIFORM with n < number_of_lessons this is equivalent to seeded sampling
    of n distinct lessons. For TCF_WEIGHTED short tests it becomes weighted sampling
    without replacement across all positive-weight lessons.
    """
    if total < 0:
        raise ValueError("total must be non-negative")
    if not isinstance(seed, str) or not seed:
        raise ValueError("seed must be a non-empty string")

    keys = list(stable_order or sorted(weights))
    vals = {key: float(weights.get(key, 0)) for key in keys}
    if any(value < 0 for value in vals.values()):
        raise ValueError("negative weight")
    weight_sum = sum(vals.values())
    if total and weight_sum <= 0:
        raise ValueError("positive weight required")
    if total == 0:
        return {key: 0 for key in keys}

    expected = {key: total * vals[key] / weight_sum for key in keys}
    out = {key: int(math.floor(expected[key])) for key in keys}
    residual = total - sum(out.values())
    if residual == 0:
        return out

    fractional = {
        key: max(0.0, expected[key] - out[key])
        for key in keys
        if expected[key] - out[key] > 1e-15
    }
    if len(fractional) < residual:
        # This should be mathematically impossible except for pathological floating
        # precision. Fail loudly instead of silently changing the requested quotas.
        raise ValueError("insufficient positive fractional remainders")

    # Efraimidis-Spirakis / exponential-race weighted sampling without replacement.
    # Smaller -log(U)/weight wins. A stable key is included as a final deterministic
    # tie-break only for the astronomically unlikely equal-score case.
    ranked = sorted(
        fractional,
        key=lambda key: (
            -math.log(_unit_interval(seed, stream, key)) / fractional[key],
            str(key),
        ),
    )
    for key in ranked[:residual]:
        out[key] += 1
    return out


def _sum100(mix: Mapping[Any, float]) -> bool:
    return abs(sum(float(value) for value in mix.values()) - 100.0) < 1e-9


def validate_config(config: Mapping[str, Any]) -> bool:
    if config.get("schema_version") != CONFIG_SCHEMA_VERSION:
        raise GeneratorError("CONFIG_INVALID", "schema/count")
    if int(config.get("question_count", 0)) < 1:
        raise GeneratorError("CONFIG_INVALID", "schema/count")

    mode = config.get("mode")
    if mode == "adaptive":
        raise GeneratorError("MODE_DEFERRED_STAGE14", "adaptive belongs Stage14")
    if mode == "review":
        raise GeneratorError("MODE_DEFERRED_STAGE16", "review belongs Stage16")
    if mode not in {"custom", "tcf"}:
        raise GeneratorError("CONFIG_INVALID", "mode")

    difficulty_mix = config.get("difficulty_mix_pct", {})
    if set(difficulty_mix) != set(DIFFICULTIES) or not _sum100(difficulty_mix):
        raise GeneratorError("CONFIG_INVALID", "difficulty mix")

    allocation = config.get("lesson_allocation", {})
    if mode == "tcf" and allocation.get("strategy") != "TCF_WEIGHTED":
        raise GeneratorError("CONFIG_INVALID", "tcf allocation")

    scope = config.get("scope", {})
    if not scope.get("clauses") or scope.get("combine") not in {"AND", "OR"}:
        raise GeneratorError("CONFIG_INVALID", "scope")
    return True


def _matches_scope(candidate: Mapping[str, Any], scope: Mapping[str, Any]) -> bool:
    answers: list[bool] = []
    tags = set(candidate.get("tag_ids", []))
    field_by_dimension = {
        "LESSON": "lesson_id",
        "SUBTOPIC": "subtopic_id",
        "CATEGORY": "category_id",
        "SUBCATEGORY": "subcategory_id",
    }
    for clause in scope["clauses"]:
        ids = set(clause["ids"])
        dimension = clause["dimension"]
        if dimension == "TAG":
            match = (
                ids <= tags
                if clause.get("tag_match", "ANY") == "ALL"
                else bool(ids & tags)
            )
        else:
            field = field_by_dimension.get(dimension, "__")
            match = candidate.get(field) in ids
        answers.append(match)
    return all(answers) if scope["combine"] == "AND" else any(answers)


def eligible(candidate: Mapping[str, Any], config: Mapping[str, Any]) -> bool:
    if not _matches_scope(candidate, config["scope"]):
        return False
    if (
        candidate.get("status") != "PUBLISHED"
        or not candidate.get("serving_enabled", False)
        or not candidate.get("is_current_revision", False)
        or candidate.get("blocked_not_scorable", False)
    ):
        return False
    compatibility = candidate.get("compatibility_status")
    return compatibility in {"PREFERRED", "ALLOWED"} or (
        compatibility == "CONDITIONAL"
        and candidate.get("conditional_guardrail_passed", False)
    )


def lesson_quotas(
    config: Mapping[str, Any],
    lessons: Sequence[str],
    tcf: Mapping[str, float] | None = None,
    *,
    seed: str | None = None,
) -> dict[str, int]:
    question_count = int(config["question_count"])
    strategy = config["lesson_allocation"]["strategy"]
    if not lessons:
        raise GeneratorError("SCOPE_EMPTY", "no lesson")

    if strategy == "UNIFORM":
        weights = {lesson_id: 1.0 for lesson_id in lessons}
    elif strategy == "TCF_WEIGHTED":
        weights = {lesson_id: float((tcf or {}).get(lesson_id, 0)) for lesson_id in lessons}
    elif strategy == "EXPLICIT_PCT":
        weights = {
            lesson_id: float(config["lesson_allocation"]["mix_pct"].get(lesson_id, 0))
            for lesson_id in lessons
        }
    else:
        raise GeneratorError("CONFIG_INVALID", "lesson allocation")

    resolved_seed = str(seed or config.get("seed") or "")
    if not resolved_seed:
        # Direct legacy callers of lesson_quotas() may omit a seed. Preserve their
        # deterministic behavior rather than introducing hidden process randomness.
        return largest_remainder(question_count, weights, lessons)

    try:
        return seeded_stochastic_remainder(
            question_count,
            weights,
            seed=resolved_seed,
            stream=f"lesson-allocation:{strategy}",
            stable_order=lessons,
        )
    except ValueError as exc:
        raise GeneratorError("CONFIG_INVALID", str(exc)) from exc


def matrix_round_exact(rows: Mapping[Any, int], cols: Mapping[Any, int], wfun) -> dict[tuple[Any, Any], int]:
    if sum(rows.values()) != sum(cols.values()):
        raise GeneratorError("QUOTA_INFEASIBLE", "margins")

    row_keys = list(rows)
    col_keys = list(cols)
    total = sum(rows.values())
    source = 0
    row_start = 1
    col_start = 1 + len(row_keys)
    sink = col_start + len(col_keys)
    size = sink + 1
    capacity = [[0] * size for _ in range(size)]
    adjacency = [[] for _ in range(size)]

    def edge(u: int, v: int, amount: int) -> None:
        adjacency[u].append(v)
        adjacency[v].append(u)
        capacity[u][v] = amount

    for index, row in enumerate(row_keys):
        edge(source, row_start + index, rows[row])
    for index, col in enumerate(col_keys):
        edge(col_start + index, sink, cols[col])
    for row_index, row in enumerate(row_keys):
        for col in sorted(col_keys, key=lambda key: (-float(wfun(row, key)), str(key))):
            if wfun(row, col) > 0:
                edge(row_start + row_index, col_start + col_keys.index(col), total)

    flow = 0
    while True:
        parent = [-1] * size
        parent[source] = source
        queue = deque([source])
        while queue and parent[sink] < 0:
            u = queue.popleft()
            for v in adjacency[u]:
                if parent[v] < 0 and capacity[u][v] > 0:
                    parent[v] = u
                    queue.append(v)
        if parent[sink] < 0:
            break

        pushed = 10**9
        v = sink
        while v != source:
            pushed = min(pushed, capacity[parent[v]][v])
            v = parent[v]
        v = sink
        while v != source:
            u = parent[v]
            capacity[u][v] -= pushed
            capacity[v][u] += pushed
            v = u
        flow += pushed

    if flow != total:
        raise GeneratorError(
            "QUOTA_INFEASIBLE",
            "compatibility",
            {"required": total, "flow": flow},
        )

    return {
        (row, col): capacity[col_start + col_index][row_start + row_index]
        for row_index, row in enumerate(row_keys)
        for col_index, col in enumerate(col_keys)
        if capacity[col_start + col_index][row_start + row_index]
    }


def generate_plan(
    config: Mapping[str, Any],
    candidates: Sequence[Mapping[str, Any]],
    tcf_weights: Mapping[str, float] | None = None,
    type_weights: Mapping[str, Mapping[str, float]] | None = None,
) -> dict[str, Any]:
    validate_config(config)
    pool = [dict(candidate) for candidate in candidates if eligible(candidate, config)]
    if not pool:
        raise GeneratorError(
            "NO_ELIGIBLE_QUESTIONS",
            "no published serving-compatible item",
        )

    seed = str(config.get("seed") or secrets.token_hex(16))
    lessons = sorted({candidate["lesson_id"] for candidate in pool})
    lesson_quota = lesson_quotas(
        config,
        lessons,
        tcf_weights,
        seed=seed,
    )
    difficulty_quota = largest_remainder(
        int(config["question_count"]),
        config["difficulty_mix_pct"],
        DIFFICULTIES,
    )

    n = int(config["question_count"])
    lesson_difficulty = matrix_round_exact(
        lesson_quota,
        difficulty_quota,
        lambda lesson_id, difficulty: (
            (lesson_quota[lesson_id] / n) * (difficulty_quota[difficulty] / n)
        ),
    )

    if config["type_allocation"]["strategy"] == "EXPLICIT_PCT":
        type_quota = largest_remainder(
            n,
            config["type_allocation"]["mix_pct"],
        )
    else:
        global_type_weights: defaultdict[str, float] = defaultdict(float)
        for lesson_id, count in lesson_quota.items():
            local = (type_weights or {}).get(lesson_id, {})
            local_sum = sum(max(0, float(value)) for value in local.values())
            if count and local_sum <= 0:
                raise GeneratorError(
                    "QUOTA_INFEASIBLE",
                    "no type weights",
                    {"lesson_id": lesson_id},
                )
            for question_type, value in local.items():
                global_type_weights[question_type] += count * max(0, float(value)) / local_sum
        type_quota = largest_remainder(n, global_type_weights)

    strata = matrix_round_exact(
        lesson_difficulty,
        type_quota,
        lambda lesson_and_difficulty, question_type: (
            float((type_weights or {}).get(lesson_and_difficulty[0], {}).get(question_type, 0))
            if config["type_allocation"]["strategy"] != "EXPLICIT_PCT"
            else float(config["type_allocation"]["mix_pct"].get(question_type, 0))
        ),
    )

    return {
        "seed": seed,
        "lesson_quotas": lesson_quota,
        "difficulty_quotas": difficulty_quota,
        "type_quotas": type_quota,
        "strata": {
            f"{lesson_id}|{difficulty}|{question_type}": amount
            for ((lesson_id, difficulty), question_type), amount in strata.items()
        },
        "generator_version": GENERATOR_VERSION,
        "quota_policy_version": QUOTA_POLICY_VERSION,
        "lesson_allocation_strategy": config["lesson_allocation"]["strategy"],
        "lesson_remainder_policy": "SEEDED_WEIGHTED_WITHOUT_REPLACEMENT",
    }

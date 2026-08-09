from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import math
import platform
import statistics
import time
from typing import Any, Callable

from adaptive.selector import select_adaptive
from backend.application import InMemoryLearningStore, LearningApplication

from stage24_fixtures import PERFORMANCE, REFERENCE


def _candidate(index: int) -> dict[str, Any]:
    difficulties = ("EASY", "MEDIUM", "HARD", "VERY_HARD")
    return {
        "question_revision_id": f"stage24-question-{index:05d}",
        "lesson_id": f"stage24-lesson-{index % 52:02d}",
        "subtopic_id": f"stage24-subtopic-{index % 304:03d}",
        "question_type_code": f"stage24-type-{index % 15:02d}",
        "difficulty": difficulties[index % len(difficulties)],
        "status": "PUBLISHED",
        "is_current_revision": True,
        "serving_enabled": True,
        "in_scope": True,
        "blocked_not_scorable": False,
        "compatibility_status": "ALLOWED",
        "tcf_weight_pct": 0.5 + (index % 199) / 100,
        "mastery_score_pct": 65,
        "mastery_confidence": 0.8,
        "days_overdue": index % 21,
        "days_since_seen": 30 + index % 60,
        "misconception_repeat_count": index % 4,
    }


def build_selection_case(profile: dict[str, Any] | None = None):
    cfg = profile or PERFORMANCE
    candidates = [_candidate(index) for index in range(int(cfg["question_bank_rows"]))]
    selection_config = {
        "question_count": int(cfg["adaptive_question_count"]),
        "seed": str(cfg["seed"]),
        "diversity": {"max_lesson_share": 0.10, "max_type_share": 0.20, "strict": True},
    }
    return selection_config, candidates


def build_dashboard_case(profile: dict[str, Any] | None = None):
    cfg = profile or PERFORMANCE
    user_id = REFERENCE["user_id"]
    store = InMemoryLearningStore()
    for index in range(int(cfg["dashboard_mastery_scopes"])):
        scope_id = f"stage24-subtopic-{index:03d}"
        store.mastery[(user_id, scope_id)] = {
            "mastery_score_pct": round(40 + index % 55, 6),
            "confidence": 0.6,
            "coverage_ratio": 1.0,
            "evidence_count": 6,
            "mastery_band": "DEVELOPING",
            "model_version": "mastery-evidence-v0.9.0",
        }
    for index in range(int(cfg["dashboard_history_points"])):
        store.mastery_snapshots.append(
            {
                "user_id": user_id,
                "scope_type": "SUBTOPIC",
                "scope_id": f"stage24-subtopic-{index % 304:03d}",
                "mastery_score_pct": round(40 + index % 55, 6),
                "confidence": 0.6,
                "coverage_ratio": 1.0,
                "evidence_count": 6,
                "mastery_band": "DEVELOPING",
                "model_version": "mastery-evidence-v0.9.0",
                "captured_at": REFERENCE["now"],
            }
        )
    return LearningApplication(store=store, now=lambda: REFERENCE["now"]), user_id


def _measure(fn: Callable[[], Any], warmups: int, iterations: int) -> dict[str, Any]:
    for _ in range(warmups):
        fn()
    samples = []
    for _ in range(iterations):
        started = time.perf_counter_ns()
        result = fn()
        elapsed_ms = (time.perf_counter_ns() - started) / 1_000_000
        samples.append(elapsed_ms)
        if result is None:
            raise AssertionError("performance operation returned no result")
    ordered = sorted(samples)
    p95_index = max(0, math.ceil(0.95 * len(ordered)) - 1)
    return {
        "samples_ms": [round(value, 3) for value in samples],
        "median_ms": round(statistics.median(samples), 3),
        "p95_ms": round(ordered[p95_index], 3),
    }


def run_reference_baseline(profile: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = deepcopy(profile or PERFORMANCE)
    selection_config, candidates = build_selection_case(cfg)
    app, user_id = build_dashboard_case(cfg)
    selection = _measure(
        lambda: select_adaptive(selection_config, candidates),
        int(cfg["warmups"]),
        int(cfg["iterations"]),
    )
    dashboard = _measure(
        lambda: app.get_dashboard(user_id, as_of=REFERENCE["now"]),
        int(cfg["warmups"]),
        int(cfg["iterations"]),
    )
    selection["budget_ms"] = float(cfg["selection_p95_budget_ms"])
    selection["pass"] = selection["p95_ms"] <= selection["budget_ms"]
    dashboard["budget_ms"] = float(cfg["dashboard_p95_budget_ms"])
    dashboard["pass"] = dashboard["p95_ms"] <= dashboard["budget_ms"]
    return {
        "stage": 24,
        "profile_version": cfg["profile_version"],
        "classification": cfg["classification"],
        "measured_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "environment": {
            "python": platform.python_version(),
            "implementation": platform.python_implementation(),
            "platform": platform.platform(),
            "storage": "IN_MEMORY_REFERENCE",
        },
        "volume": {
            "question_bank_rows": int(cfg["question_bank_rows"]),
            "dashboard_mastery_scopes": int(cfg["dashboard_mastery_scopes"]),
            "dashboard_history_points": int(cfg["dashboard_history_points"]),
        },
        "selection": selection,
        "dashboard": dashboard,
        "overall_pass": bool(selection["pass"] and dashboard["pass"]),
        "production_sla": "NOT_CLAIMED",
    }

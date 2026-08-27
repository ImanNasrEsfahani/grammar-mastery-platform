from __future__ import annotations

from collections import Counter

from adaptive.selector import (
    CONFIG_SCHEMA_VERSION,
    SELECTOR_VERSION,
    select_adaptive,
)


def _candidate(
    lesson: int,
    question: int,
    *,
    weak: bool = False,
    category: str | None = None,
    subcategory: str | None = None,
):
    lesson_id = f"L{lesson:02d}"
    category_id = category or f"C{((lesson - 1) // 2) + 1:02d}"
    subcategory_id = subcategory or f"SC{((lesson - 1) // 2) + 1:02d}"
    return {
        "question_revision_id": f"{lesson_id}-R{question:03d}",
        "question_uid": f"{lesson_id}-Q{question:03d}",
        "lesson_id": lesson_id,
        "category_id": category_id,
        "subcategory_id": subcategory_id,
        "subtopic_id": f"{lesson_id}-S{question % 3}",
        "question_type_code": (
            "CLOZE_SINGLE",
            "CLOZE_CONTEXT",
            "CORRECT_SENTENCE",
            "TENSE_CHOICE",
            "REWRITE_EQUIV",
        )[question % 5],
        "difficulty": "MEDIUM",
        "tcf_weight_pct": 2.0,
        "status": "PUBLISHED",
        "is_current_revision": True,
        "serving_enabled": True,
        "in_scope": True,
        "compatibility_status": "ALLOWED",
        "conditional_guardrail_passed": True,
        "blocked_not_scorable": False,
        "mastery_score_pct": 20.0 if weak else 90.0,
        "mastery_confidence": 0.95,
        "days_overdue": 14.0 if weak else 0.0,
        "misconception_repeat_count": 3 if weak else 0,
        "days_since_seen": None,
    }


def _pool(weak_lessons=(), *, same_weak_category=False):
    weak_lessons = set(weak_lessons)
    rows = []
    for lesson in range(1, 11):
        category = "WEAK-CATEGORY" if same_weak_category and lesson in weak_lessons else None
        subcategory = "WEAK-SUBCATEGORY" if same_weak_category and lesson in weak_lessons else None
        for question in range(30):
            rows.append(
                _candidate(
                    lesson,
                    question,
                    weak=lesson in weak_lessons,
                    category=category,
                    subcategory=subcategory,
                )
            )
    return rows


def _config(seed="balanced-general-test"):
    return {
        "schema_version": CONFIG_SCHEMA_VERSION,
        "mode": "adaptive",
        "question_count": 20,
        "seed": seed,
    }


def test_general_adaptive_uses_exact_75_10_15_quota_for_20_questions():
    result = select_adaptive(_config(), _pool())
    assert result["selector_version"] == SELECTOR_VERSION
    assert result["selection_bucket_quota"] == {
        "COVERAGE": 15,
        "ADAPTIVE": 2,
        "EXPLORATION": 3,
    }
    assert result["selection_bucket_counts"] == result["selection_bucket_quota"]


def test_single_weak_lesson_cannot_dominate_broad_general_scope():
    result = select_adaptive(_config("one-weak"), _pool({1}))
    lesson_counts = Counter(item["lesson_id"] for item in result["selected"])
    assert result["lesson_cap_count"] == 4
    assert lesson_counts["L01"] <= 4
    assert len(lesson_counts) >= 8


def test_weak_category_cannot_take_over_general_practice():
    result = select_adaptive(
        _config("weak-category"),
        _pool({1, 2, 3}, same_weak_category=True),
    )
    category_counts = Counter(item["category_id"] for item in result["selected"])
    assert result["category_cap_count"] == 7
    assert category_counts["WEAK-CATEGORY"] <= 7
    assert len(category_counts) >= 5


def test_same_pool_and_seed_is_deterministic():
    first = select_adaptive(_config("deterministic"), _pool({1, 2}))
    second = select_adaptive(_config("deterministic"), _pool({1, 2}))
    assert first["selection_digest"] == second["selection_digest"]
    assert [q["question_revision_id"] for q in first["selected"]] == [
        q["question_revision_id"] for q in second["selected"]
    ]


def test_legacy_candidates_without_category_fields_still_work():
    rows = []
    for lesson in range(1, 5):
        for question in range(20):
            item = _candidate(lesson, question)
            item.pop("category_id")
            item.pop("subcategory_id")
            rows.append(item)
    result = select_adaptive(_config("legacy-no-category"), rows)
    assert result["selected_count"] == 20
    assert result["category_cap_count"] == 20
    assert result["subcategory_cap_count"] == 20

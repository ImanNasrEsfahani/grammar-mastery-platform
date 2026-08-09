from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import threading
import uuid
from typing import Any, Callable, Iterator

from error_review.engine import apply_event, group_items, materialize_error_items
from mastery.engine import compute_subtopic_mastery
from spaced_repetition.scheduler import queue_status, transition

from .errors import APIError, not_found
from .idempotency import IdempotentResult, InMemoryIdempotencyRegistry
from .projections import answer_feedback, public_attempt_question


MASTERY_PROVIDER_VERSION = "mastery-provider-contract-v0.9.0"


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class InMemoryLearningStore:
    """Transactional reference store mirroring the Stage 12–17 write sets."""

    _transactional_attributes = (
        "tests",
        "attempts",
        "answers",
        "mastery",
        "mastery_snapshots",
        "review_items",
        "review_events",
        "srs",
        "srs_events",
    )

    def __init__(self) -> None:
        self.tests: dict[str, dict[str, Any]] = {}
        self.attempts: dict[str, dict[str, Any]] = {}
        self.answers: list[dict[str, Any]] = []
        self.mastery: dict[tuple[str, str], dict[str, Any]] = {}
        self.mastery_snapshots: list[dict[str, Any]] = []
        self.review_items: dict[str, dict[str, Any]] = {}
        self.review_events: list[dict[str, Any]] = []
        self.srs: dict[tuple[str, str], dict[str, Any]] = {}
        self.srs_events: list[dict[str, Any]] = []
        self._lock = threading.RLock()

    @contextmanager
    def transaction(self) -> Iterator[None]:
        with self._lock:
            snapshot = {
                name: deepcopy(getattr(self, name)) for name in self._transactional_attributes
            }
            try:
                yield
            except Exception:
                for name, value in snapshot.items():
                    setattr(self, name, value)
                raise


class LearningApplication:
    """Stage 21 application service for the high-risk learner write path."""

    def __init__(
        self,
        store: InMemoryLearningStore | None = None,
        now: Callable[[], str] = utcnow_iso,
        after_mastery_hook: Callable[[], None] | None = None,
    ) -> None:
        self.store = store or InMemoryLearningStore()
        self.now = now
        self.after_mastery_hook = after_mastery_hook

    @staticmethod
    def _normalize_snapshot(snapshot: dict[str, Any], position: int) -> dict[str, Any]:
        required = {
            "question_revision_id",
            "question_uid",
            "lesson_id",
            "subtopic_id",
            "stem",
            "difficulty",
            "correct_option_id",
            "options",
            "question_status",
            "serving_enabled",
            "is_current_revision",
            "blocked_not_scorable",
            "compatibility_status",
        }
        missing = sorted(required - set(snapshot))
        if missing:
            raise APIError(
                422,
                "VALIDATION_ERROR",
                "The frozen question snapshot is incomplete.",
                {key: ["This field is required."] for key in missing},
            )
        options = deepcopy(snapshot["options"])
        if len(options) != 4:
            raise APIError(
                422,
                "VALIDATION_ERROR",
                "The frozen question snapshot is invalid.",
                {"options": ["Exactly four options are required."]},
            )
        option_ids = [str(option.get("id")) for option in options]
        option_positions = [str(option.get("position")) for option in options]
        if len(set(option_ids)) != 4 or str(snapshot["correct_option_id"]) not in option_ids:
            raise APIError(
                422,
                "VALIDATION_ERROR",
                "The frozen question snapshot is invalid.",
                {"correct_option_id": ["It must identify one unique frozen option."]},
            )
        if set(option_positions) != {"A", "B", "C", "D"}:
            raise APIError(
                422,
                "VALIDATION_ERROR",
                "The frozen question snapshot is invalid.",
                {"options": ["Positions A, B, C and D must each appear exactly once."]},
            )
        for option in options:
            if not str(option.get("text", "")).strip() or not str(option.get("explanation", "")).strip():
                raise APIError(
                    422,
                    "VALIDATION_ERROR",
                    "The frozen question snapshot is invalid.",
                    {"options": ["Every option needs text and an explanation."]},
                )
            is_correct = str(option["id"]) == str(snapshot["correct_option_id"])
            if is_correct and option.get("misconception_id") is not None:
                raise APIError(
                    422,
                    "VALIDATION_ERROR",
                    "The frozen question snapshot is invalid.",
                    {"options": ["The correct option cannot map to a misconception."]},
                )
            if not is_correct and option.get("misconception_id") is None:
                raise APIError(
                    422,
                    "VALIDATION_ERROR",
                    "The frozen question snapshot is invalid.",
                    {"options": ["Every distractor must map to a misconception."]},
                )
        if snapshot["difficulty"] not in {"EASY", "MEDIUM", "HARD", "VERY_HARD"}:
            raise APIError(
                422,
                "VALIDATION_ERROR",
                "The frozen question snapshot is invalid.",
                {"difficulty": ["Use EASY, MEDIUM, HARD or VERY_HARD."]},
            )
        compatibility = snapshot["compatibility_status"]
        safe_compatibility = compatibility in {"PREFERRED", "ALLOWED"} or (
            compatibility == "CONDITIONAL"
            and snapshot.get("conditional_guardrail_passed") is True
        )
        if (
            snapshot["question_status"] != "PUBLISHED"
            or snapshot["serving_enabled"] is not True
            or snapshot["is_current_revision"] is not True
            or snapshot["blocked_not_scorable"] is not False
            or not safe_compatibility
        ):
            raise APIError(
                422,
                "NO_ELIGIBLE_QUESTIONS",
                "No safe published questions are available for this test.",
            )
        normalized = deepcopy(snapshot)
        normalized["test_question_id"] = str(
            snapshot.get("test_question_id") or uuid.uuid4()
        )
        normalized["position"] = int(position)
        normalized["options"] = options
        normalized.setdefault("stem_locale", "fr-FR")
        normalized.setdefault("question_type", "SINGLE_CHOICE_4")
        normalized.setdefault("full_explanation", None)
        return normalized

    def create_test_snapshot(
        self,
        user_id: str,
        snapshots: list[dict[str, Any]],
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Persist output from a Stage13/14 selection port as an immutable test.

        This method does not replace Stage13 selection.  It is the Stage21
        persistence boundary receiving already-selected exact revisions.
        """
        if not snapshots:
            raise APIError(
                422,
                "NO_ELIGIBLE_QUESTIONS",
                "No safe published questions are available for this test.",
            )
        normalized = [self._normalize_snapshot(row, index) for index, row in enumerate(snapshots, 1)]
        revision_ids = [row["question_revision_id"] for row in normalized]
        if len(set(revision_ids)) != len(revision_ids):
            raise APIError(
                422,
                "VALIDATION_ERROR",
                "A test cannot contain the same question revision twice.",
            )
        test_id = str(uuid.uuid4())
        test = {
            "id": test_id,
            "user_id": str(user_id),
            "config": deepcopy(config or {}),
            "questions": normalized,
            "created_at": self.now(),
        }
        with self.store.transaction():
            self.store.tests[test_id] = test
        return self.get_test_metadata(user_id, test_id)

    def _owned_test(self, user_id: str, test_id: str) -> dict[str, Any]:
        test = self.store.tests.get(str(test_id))
        if test is None or test["user_id"] != str(user_id):
            raise not_found()
        return test

    def _owned_attempt(self, user_id: str, attempt_id: str) -> dict[str, Any]:
        attempt = self.store.attempts.get(str(attempt_id))
        if attempt is None or attempt["user_id"] != str(user_id):
            raise not_found()
        return attempt

    def get_test_metadata(self, user_id: str, test_id: str) -> dict[str, Any]:
        test = self._owned_test(user_id, test_id)
        return {
            "id": test["id"],
            "mode": str(test["config"].get("mode", "custom")),
            "title": test["config"].get("title"),
            "question_count": len(test["questions"]),
            "selection_model_version": str(
                test["config"].get("selection_model_version", "test-generator-v0.9.0")
            ),
            "created_at": test["created_at"],
        }

    def start_attempt(self, user_id: str, test_id: str) -> dict[str, Any]:
        self._owned_test(user_id, test_id)
        attempt_id = str(uuid.uuid4())
        attempt = {
            "id": attempt_id,
            "test_id": str(test_id),
            "user_id": str(user_id),
            "status": "IN_PROGRESS",
            "started_at": self.now(),
            "completed_at": None,
            "score_raw": None,
            "score_pct": None,
        }
        with self.store.transaction():
            self.store.attempts[attempt_id] = attempt
        return self._attempt_projection(attempt)

    @staticmethod
    def _attempt_projection(attempt: dict[str, Any]) -> dict[str, Any]:
        return {
            key: deepcopy(attempt[key])
            for key in (
                "id",
                "test_id",
                "status",
                "started_at",
                "completed_at",
                "score_raw",
                "score_pct",
            )
        }

    def _attempt_answers(self, attempt_id: str) -> list[dict[str, Any]]:
        return [row for row in self.store.answers if row["attempt_id"] == str(attempt_id)]

    def _snapshot_for(
        self, attempt: dict[str, Any], test_question_id: str
    ) -> dict[str, Any]:
        test = self.store.tests[attempt["test_id"]]
        for snapshot in test["questions"]:
            if snapshot["test_question_id"] == str(test_question_id):
                return snapshot
        raise APIError(
            422,
            "VALIDATION_ERROR",
            "The question does not belong to this attempt.",
            {"test_question_id": ["Use a frozen question from this attempt."]},
        )

    def get_next_question(self, user_id: str, attempt_id: str) -> dict[str, Any] | None:
        attempt = self._owned_attempt(user_id, attempt_id)
        if attempt["status"] != "IN_PROGRESS":
            raise APIError(409, "STATE_CONFLICT", "The attempt is not in progress.")
        answered = {row["test_question_id"] for row in self._attempt_answers(attempt_id)}
        test = self.store.tests[attempt["test_id"]]
        for snapshot in test["questions"]:
            if snapshot["test_question_id"] not in answered:
                return public_attempt_question(snapshot)
        return None

    def submit_answer(
        self,
        user_id: str,
        attempt_id: str,
        test_question_id: str,
        selected_option_id: str,
        response_ms: int | None = None,
        answered_at: str | None = None,
    ) -> dict[str, Any]:
        with self.store.transaction():
            attempt = self._owned_attempt(user_id, attempt_id)
            if attempt["status"] != "IN_PROGRESS":
                raise APIError(409, "STATE_CONFLICT", "The attempt is not in progress.")
            snapshot = self._snapshot_for(attempt, test_question_id)
            if any(
                row["test_question_id"] == str(test_question_id)
                for row in self._attempt_answers(attempt_id)
            ):
                raise APIError(
                    409,
                    "ANSWER_ALREADY_SUBMITTED",
                    "This question already has an accepted answer.",
                )
            if response_ms is not None and int(response_ms) < 0:
                raise APIError(
                    422,
                    "VALIDATION_ERROR",
                    "The request contains invalid fields.",
                    {"response_ms": ["Must be zero or greater."]},
                )
            feedback = answer_feedback(snapshot, selected_option_id)
            selected = next(
                option
                for option in snapshot["options"]
                if str(option["id"]) == str(selected_option_id)
            )
            answer_id = str(uuid.uuid4())
            event_at = answered_at or self.now()
            answer = {
                "id": answer_id,
                "answer_id": answer_id,
                "attempt_id": str(attempt_id),
                "test_question_id": str(test_question_id),
                "answer_sequence": 1,
                "user_id": str(user_id),
                "question_id": str(snapshot["question_revision_id"]),
                "question_uid": str(snapshot["question_uid"]),
                "lesson_id": str(snapshot["lesson_id"]),
                "subtopic_id": str(snapshot["subtopic_id"]),
                "misconception_id": None
                if feedback["is_correct"]
                else selected.get("misconception_id"),
                "difficulty_code": str(snapshot["difficulty"]),
                "selected_option_id": str(selected_option_id),
                "is_correct": bool(feedback["is_correct"]),
                "response_ms": None if response_ms is None else int(response_ms),
                "answered_at": event_at,
                "question_status": str(snapshot.get("question_status", "PUBLISHED")),
                "serving_enabled": bool(snapshot.get("serving_enabled", True)),
                "content_issue_excluded": False,
            }
            self.store.answers.append(answer)

            evidence = [
                row
                for row in self.store.answers
                if row["user_id"] == str(user_id)
                and row["subtopic_id"] == str(snapshot["subtopic_id"])
            ]
            mastery = compute_subtopic_mastery(evidence, event_at)
            mastery_key = (str(user_id), str(snapshot["subtopic_id"]))
            self.store.mastery[mastery_key] = deepcopy(mastery)
            self.store.mastery_snapshots.append(
                {
                    **deepcopy(mastery),
                    "user_id": str(user_id),
                    "scope_type": "SUBTOPIC",
                    "scope_id": str(snapshot["subtopic_id"]),
                    "captured_at": event_at,
                    "source_event": "ANSWER_ACCEPTED",
                }
            )
            if self.after_mastery_hook is not None:
                self.after_mastery_hook()

            review_item_id = None
            if not answer["is_correct"]:
                item = materialize_error_items([answer])[0]
                review_item_id = str(uuid.uuid4())
                item["id"] = review_item_id
                self.store.review_items[review_item_id] = item

            previous_srs = self.store.srs.get(mastery_key)
            next_srs = transition(
                previous_srs,
                {
                    "kind": "ANSWER",
                    "event_at": event_at,
                    "is_correct": answer["is_correct"],
                    "answer_id": answer_id,
                    "mastery_band": mastery["mastery_band"],
                    "mastery_confidence": mastery["confidence"],
                    "mastery_provider_contract_version": MASTERY_PROVIDER_VERSION,
                },
            )
            next_srs["user_id"] = str(user_id)
            next_srs["subtopic_id"] = str(snapshot["subtopic_id"])
            next_srs["status"] = queue_status(next_srs, event_at)
            self.store.srs[mastery_key] = deepcopy(next_srs)
            self.store.srs_events.append(
                {
                    "id": str(uuid.uuid4()),
                    "user_id": str(user_id),
                    "subtopic_id": str(snapshot["subtopic_id"]),
                    "source_answer_id": answer_id,
                    "from_state": None if previous_srs is None else previous_srs["learning_state"],
                    "to_state": next_srs["learning_state"],
                    "event_at": event_at,
                    "scheduler_version": next_srs["scheduler_version"],
                }
            )

            return {
                "answer_id": answer_id,
                "attempt_id": str(attempt_id),
                "test_question_id": str(test_question_id),
                "answered_at": event_at,
                "feedback": feedback,
                "mastery": {
                    key: mastery[key]
                    for key in (
                        "mastery_score_pct",
                        "confidence",
                        "coverage_ratio",
                        "mastery_band",
                        "model_version",
                    )
                },
                "review_item_id": review_item_id,
                "review_schedule": {
                    key: next_srs.get(key)
                    for key in (
                        "learning_state",
                        "due_at",
                        "interval_days",
                        "status",
                        "scheduler_version",
                    )
                },
            }

    def submit_answer_idempotent(
        self,
        registry: InMemoryIdempotencyRegistry,
        user_id: str,
        idempotency_key: str,
        attempt_id: str,
        test_question_id: str,
        selected_option_id: str,
        response_ms: int | None = None,
        answered_at: str | None = None,
    ) -> IdempotentResult:
        body = {
            "test_question_id": str(test_question_id),
            "selected_option_id": str(selected_option_id),
            "response_ms": response_ms,
        }

        def handler() -> tuple[int, Any]:
            return 200, self.submit_answer(
                user_id,
                attempt_id,
                test_question_id,
                selected_option_id,
                response_ms=response_ms,
                answered_at=answered_at,
            )

        return registry.execute(
            user_id,
            "submitAttemptAnswer",
            idempotency_key,
            {"attemptId": str(attempt_id)},
            body,
            handler,
        )

    def complete_attempt(self, user_id: str, attempt_id: str) -> dict[str, Any]:
        with self.store.transaction():
            attempt = self._owned_attempt(user_id, attempt_id)
            if attempt["status"] == "COMPLETED":
                return deepcopy(attempt)
            if attempt["status"] != "IN_PROGRESS":
                raise APIError(409, "STATE_CONFLICT", "The attempt cannot be completed.")
            test = self.store.tests[attempt["test_id"]]
            answers = self._attempt_answers(attempt_id)
            if len(answers) != len(test["questions"]):
                raise APIError(
                    409,
                    "STATE_CONFLICT",
                    "Every frozen question must be answered before completion.",
                )
            correct = sum(bool(row["is_correct"]) for row in answers)
            attempt["status"] = "COMPLETED"
            attempt["completed_at"] = self.now()
            attempt["score_raw"] = correct
            attempt["score_pct"] = round(100 * correct / len(answers), 6)
            return self._attempt_projection(attempt)

    def get_result(self, user_id: str, attempt_id: str) -> dict[str, Any]:
        attempt = self._owned_attempt(user_id, attempt_id)
        if attempt["status"] != "COMPLETED":
            raise APIError(409, "STATE_CONFLICT", "The result is available after completion.")
        test = self.store.tests[attempt["test_id"]]
        answers = {row["test_question_id"]: row for row in self._attempt_answers(attempt_id)}
        breakdown = []
        for snapshot in test["questions"]:
            answer = answers[snapshot["test_question_id"]]
            breakdown.append(
                {
                    "test_question_id": snapshot["test_question_id"],
                    "position": snapshot["position"],
                    "answer_id": answer["id"],
                    "feedback": answer_feedback(snapshot, answer["selected_option_id"]),
                }
            )
        return {
            "attempt_id": str(attempt_id),
            "status": attempt["status"],
            "score_raw": attempt["score_raw"],
            "score_pct": attempt["score_pct"],
            "completed_at": attempt["completed_at"],
            "breakdown": breakdown,
        }

    def list_review_groups(self, user_id: str) -> list[dict[str, Any]]:
        items = [
            deepcopy(item)
            for item in self.store.review_items.values()
            if item["user_id"] == str(user_id)
        ]
        return group_items(items)

    def _owned_review_item(self, user_id: str, review_id: str) -> dict[str, Any]:
        item = self.store.review_items.get(str(review_id))
        if item is None or item["user_id"] != str(user_id):
            raise not_found()
        return item

    def _snapshot_by_test_question(self, test_question_id: str) -> dict[str, Any]:
        for test in self.store.tests.values():
            for snapshot in test["questions"]:
                if snapshot["test_question_id"] == str(test_question_id):
                    return snapshot
        raise not_found()

    def grade_review(
        self,
        user_id: str,
        review_id: str,
        selected_option_id: str,
        event_at: str | None = None,
    ) -> dict[str, Any]:
        with self.store.transaction():
            item = self._owned_review_item(user_id, review_id)
            snapshot = self._snapshot_by_test_question(item["test_question_id"])
            feedback = answer_feedback(snapshot, selected_option_id)
            event = {
                "id": str(uuid.uuid4()),
                "review_item_id": str(review_id),
                "user_id": str(user_id),
                "event_type": "RETRY_SUBMITTED",
                "selected_option_id": str(selected_option_id),
                "is_correct": feedback["is_correct"],
                "event_at": event_at or self.now(),
            }
            updated = apply_event(item, event)
            updated["id"] = str(review_id)
            self.store.review_items[str(review_id)] = updated
            self.store.review_events.append(event)
            return {"review_item": deepcopy(updated), "feedback": feedback}

    def reveal_review(
        self, user_id: str, review_id: str, event_at: str | None = None
    ) -> dict[str, Any]:
        with self.store.transaction():
            item = self._owned_review_item(user_id, review_id)
            snapshot = self._snapshot_by_test_question(item["test_question_id"])
            event = {
                "id": str(uuid.uuid4()),
                "review_item_id": str(review_id),
                "user_id": str(user_id),
                "event_type": "ANSWER_REVEALED",
                "event_at": event_at or self.now(),
            }
            unchanged = apply_event(item, event)
            self.store.review_events.append(event)
            return {
                "review_item": deepcopy(unchanged),
                "feedback": answer_feedback(snapshot, snapshot["correct_option_id"]),
            }

    def set_review_mark(
        self,
        user_id: str,
        review_id: str,
        marked: bool,
        event_at: str | None = None,
    ) -> dict[str, Any]:
        with self.store.transaction():
            item = self._owned_review_item(user_id, review_id)
            event = {
                "id": str(uuid.uuid4()),
                "review_item_id": str(review_id),
                "user_id": str(user_id),
                "event_type": "MARKED_FOR_REVIEW" if marked else "UNMARKED_FOR_REVIEW",
                "event_at": event_at or self.now(),
            }
            updated = apply_event(item, event)
            updated["id"] = str(review_id)
            self.store.review_items[str(review_id)] = updated
            self.store.review_events.append(event)
            return deepcopy(updated)

    def get_mastery(self, user_id: str) -> list[dict[str, Any]]:
        rows = []
        for (owner_id, subtopic_id), mastery in sorted(self.store.mastery.items()):
            if owner_id != str(user_id):
                continue
            rows.append(
                {
                    "scope_type": "SUBTOPIC",
                    "scope_id": subtopic_id,
                    **{
                        key: mastery[key]
                        for key in (
                            "mastery_score_pct",
                            "confidence",
                            "coverage_ratio",
                            "evidence_count",
                            "mastery_band",
                            "model_version",
                        )
                    },
                }
            )
        return rows

    def get_dashboard(self, user_id: str, as_of: str | None = None) -> dict[str, Any]:
        timestamp = as_of or self.now()
        mastery = self.get_mastery(user_id)
        schedules = [
            deepcopy(row)
            for (owner_id, _), row in self.store.srs.items()
            if owner_id == str(user_id)
        ]
        due = [row for row in schedules if queue_status(row, timestamp) == "DUE"]
        groups = self.list_review_groups(user_id)
        if due:
            next_action = "OVERDUE_REVIEW"
        elif any(group["unresolved_count"] for group in groups):
            next_action = "DUE_REVIEW"
        elif not mastery:
            next_action = "BUILD_EVIDENCE"
        else:
            next_action = "REGULAR_PRACTICE"
        completed_attempts = [
            row
            for row in self.store.attempts.values()
            if row["user_id"] == str(user_id) and row["status"] == "COMPLETED"
        ]
        completed_attempts.sort(key=lambda row: (row["completed_at"], row["id"]), reverse=True)
        user_snapshots = []
        for row in self.store.mastery_snapshots:
            if row["user_id"] != str(user_id):
                continue
            user_snapshots.append(
                {
                    key: deepcopy(row[key])
                    for key in (
                        "scope_type",
                        "scope_id",
                        "mastery_score_pct",
                        "confidence",
                        "coverage_ratio",
                        "evidence_count",
                        "mastery_band",
                        "model_version",
                        "captured_at",
                    )
                }
            )
        return {
            "as_of": timestamp,
            "next_action": next_action,
            "mastery": mastery,
            "review_queue": {
                "due_count": len(due),
                "suspended_concept_count": sum(
                    row.get("learning_state") == "SUSPENDED" for row in schedules
                ),
            },
            "error_review": {
                "unresolved_group_count": sum(
                    group["unresolved_count"] > 0 for group in groups
                )
            },
            "recent_test": None
            if not completed_attempts
            else {
                "attempt_id": completed_attempts[0]["id"],
                "score_pct": completed_attempts[0]["score_pct"],
                "completed_at": completed_attempts[0]["completed_at"],
            },
            "trend": {
                "points": user_snapshots,
                "incomplete_data": len(user_snapshots) < 2,
                "warning": "INSUFFICIENT_SNAPSHOTS" if len(user_snapshots) < 2 else None,
            },
            "activity": {
                "questions_answered": sum(
                    row["user_id"] == str(user_id) for row in self.store.answers
                ),
                "tests_completed": len(completed_attempts),
                "reviews_completed": sum(
                    row["user_id"] == str(user_id)
                    and row["event_type"] == "RETRY_SUBMITTED"
                    for row in self.store.review_events
                ),
            },
        }

"""Deterministic reference scheduler for Grammar Mastery Platform Stage 17.

Roadmap state machine: NEW -> LEARNING -> REVIEW -> LAPSED, plus SUSPENDED.
The scheduler makes SUBTOPIC concepts due. Question selection remains a separate
serving concern and receives soft diversity exclusions from this module.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional


STATES = {"NEW", "LEARNING", "REVIEW", "LAPSED", "SUSPENDED"}

DEFAULT_CONFIG: Dict[str, Any] = {
    "scheduler_version": "spaced-review-v0.9.0",
    "state_machine_version": "spaced-review-state-machine-v0.9.0",
    "mastery_provider_contract_version": "mastery-provider-contract-v0.9.0",
    "target_scope": "SUBTOPIC",
    "states": ["NEW", "LEARNING", "REVIEW", "LAPSED", "SUSPENDED"],
    "stable_mastery_bands": ["STRONG"],
    "learning_intervals_days": [1.0, 3.0],
    "review_initial_days": 7.0,
    "review_growth_factor": 2.0,
    "max_review_interval_days": 180.0,
    "lapse": {
        "interval_multiplier": 0.25,
        "min_days": 1.0,
        "max_days": 3.0,
        "recovery_days": 3.0,
    },
    "diversity": {
        "recent_question_uid_window": 3,
        "prefer_different_question_uid": True,
        "relax_soft_exclusion_if_pool_exhausted": True,
        "never_relax_safety_exclusions": True,
    },
    "content_safety": {
        "question_status_required": "PUBLISHED",
        "exclude_retired_or_disabled": True,
        "exclude_confirmed_content_issue": True,
        "suspend_concept_only_when_safe_pool_empty": True,
    },
    "event_policy": {
        "unscorable_answer": "IGNORE",
        "stage16_review_retry_advances_srs": False,
        "content_exclusion_creates_lapse": False,
        "raw_history_is_append_only": True,
    },
    "queue_policy": {
        "operational_statuses": ["SCHEDULED", "DUE", "COMPLETED", "SUSPENDED"],
        "due_is_derived_from_due_at": True,
        "state_priority_for_equal_due_at": ["LAPSED", "LEARNING", "REVIEW", "NEW"],
        "marked_signal_is_tiebreak_only": True,
    },
    "calibration_status": "INITIAL_VERSIONED_CONFIGURATION_CALIBRATE_STAGE27",
}


def parse_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def validate_config(config: Dict[str, Any]) -> None:
    required = set(DEFAULT_CONFIG)
    missing = sorted(required - set(config))
    if missing:
        raise ValueError(f"S17_CONFIG_REQUIRED_FIELDS_MISSING:{','.join(missing)}")
    if config.get("scheduler_version") != DEFAULT_CONFIG["scheduler_version"]:
        raise ValueError("S17_SCHEDULER_VERSION_MISMATCH")
    if config.get("state_machine_version") != DEFAULT_CONFIG["state_machine_version"]:
        raise ValueError("S17_STATE_MACHINE_VERSION_MISMATCH")
    if config.get("mastery_provider_contract_version") != DEFAULT_CONFIG["mastery_provider_contract_version"]:
        raise ValueError("S17_MASTERY_PROVIDER_VERSION_MISMATCH")
    if config.get("target_scope") != "SUBTOPIC":
        raise ValueError("S17_TARGET_SCOPE_MUST_BE_SUBTOPIC")
    if set(config.get("states", [])) != STATES:
        raise ValueError("S17_STATE_SET_INVALID")
    learning = [float(x) for x in config.get("learning_intervals_days", [])]
    if len(learning) < 2 or any(x <= 0 for x in learning) or learning != sorted(learning):
        raise ValueError("S17_LEARNING_INTERVALS_INVALID")
    initial = float(config["review_initial_days"])
    maximum = float(config["max_review_interval_days"])
    growth = float(config["review_growth_factor"])
    if initial <= learning[-1] or maximum < initial or growth <= 1:
        raise ValueError("S17_REVIEW_INTERVAL_CONFIG_INVALID")
    lapse = config["lapse"]
    if not 0 < float(lapse["interval_multiplier"]) < 1:
        raise ValueError("S17_LAPSE_MULTIPLIER_INVALID")
    if not 0 < float(lapse["min_days"]) <= float(lapse["max_days"]) <= initial:
        raise ValueError("S17_LAPSE_RANGE_INVALID")
    if not float(lapse["min_days"]) <= float(lapse["recovery_days"]) <= initial:
        raise ValueError("S17_LAPSE_RECOVERY_INVALID")
    if config.get("stable_mastery_bands") != ["STRONG"]:
        raise ValueError("S17_STABLE_BAND_MUST_USE_STAGE15_STRONG")
    for policy_key in ("content_safety", "event_policy", "queue_policy"):
        if config.get(policy_key) != DEFAULT_CONFIG[policy_key]:
            raise ValueError(f"S17_{policy_key.upper()}_INVALID")
    if config.get("calibration_status") != DEFAULT_CONFIG["calibration_status"]:
        raise ValueError("S17_CALIBRATION_STATUS_INVALID")


def new_state() -> Dict[str, Any]:
    return {
        "learning_state": "NEW",
        "interval_days": 0.0,
        "due_at": None,
        "success_streak": 0,
        "lapse_count": 0,
        "state_before_suspend": None,
        "suspended_reason": None,
        "last_answer_id": None,
    }


def _stable(event: Dict[str, Any], config: Dict[str, Any]) -> bool:
    return event.get("mastery_band") in set(config["stable_mastery_bands"])


def _due(event_at: datetime, days: float) -> str:
    return iso(event_at + timedelta(days=days))


def _learning_interval(streak: int, config: Dict[str, Any]) -> float:
    values = [float(x) for x in config["learning_intervals_days"]]
    idx = min(max(streak, 1) - 1, len(values) - 1)
    return values[idx]


def transition(
    current: Optional[Dict[str, Any]],
    event: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return a new state; never mutates the input.

    ANSWER events require the Stage15 provider-contract version. Stage16 retry
    events are intentionally not accepted here because Stage16 v0.9 classifies
    them as resolution evidence, not mastery/SRS evidence.
    """
    cfg = DEFAULT_CONFIG if config is None else config
    validate_config(cfg)
    state = deepcopy(current or new_state())
    if state.get("learning_state") not in STATES:
        raise ValueError("S17_CURRENT_STATE_INVALID")
    kind = event.get("kind")
    event_at = parse_dt(event.get("event_at") or event.get("answered_at"))

    if kind == "SUSPEND":
        if state["learning_state"] != "SUSPENDED":
            state["state_before_suspend"] = state["learning_state"]
        state["learning_state"] = "SUSPENDED"
        state["suspended_reason"] = event.get("reason") or "NO_ELIGIBLE_QUESTION_POOL"
        state["transition_reason"] = "SAFE_POOL_UNAVAILABLE"
        return state

    if kind == "RESUME":
        if int(event.get("eligible_question_count", 0)) <= 0:
            raise ValueError("S17_RESUME_REQUIRES_SAFE_POOL")
        if state["learning_state"] != "SUSPENDED":
            state["transition_reason"] = "RESUME_NOOP_NOT_SUSPENDED"
            return state
        restored = state.get("state_before_suspend") or "LEARNING"
        if restored == "SUSPENDED" or restored not in STATES:
            restored = "LEARNING"
        state["learning_state"] = restored
        state["state_before_suspend"] = None
        state["suspended_reason"] = None
        if state.get("due_at") is None or parse_dt(state["due_at"]) <= event_at:
            state["due_at"] = iso(event_at)
        state["transition_reason"] = "SAFE_POOL_RESTORED"
        return state

    if kind == "EVIDENCE_REPLAYED":
        # Removing invalid content must never manufacture a user lapse.
        if state["learning_state"] == "REVIEW" and not _stable(event, cfg):
            interval = float(cfg["learning_intervals_days"][0])
            candidate_due = event_at + timedelta(days=interval)
            old_due = parse_dt(state["due_at"]) if state.get("due_at") else candidate_due
            state["learning_state"] = "LEARNING"
            state["interval_days"] = interval
            state["due_at"] = iso(min(old_due, candidate_due))
            state["success_streak"] = 0
            state["transition_reason"] = "MASTERY_REPLAY_DOWNGRADE_NO_LAPSE"
        else:
            state["transition_reason"] = "MASTERY_REPLAY_NO_PROMOTION"
        return state

    if kind != "ANSWER":
        raise ValueError("S17_EVENT_KIND_INVALID")
    if state["learning_state"] == "SUSPENDED":
        raise ValueError("S17_ANSWER_REJECTED_WHILE_SUSPENDED")
    if event.get("is_correct") is None:
        state["transition_reason"] = "UNSCORABLE_ANSWER_IGNORED"
        return state
    if event.get("mastery_provider_contract_version") != cfg["mastery_provider_contract_version"]:
        raise ValueError("S17_MASTERY_PROVIDER_VERSION_MISMATCH")

    correct = bool(event["is_correct"])
    stable = _stable(event, cfg)
    previous = state["learning_state"]
    interval = float(state.get("interval_days") or 0.0)
    streak = int(state.get("success_streak") or 0)
    lapse_count = int(state.get("lapse_count") or 0)

    if previous == "NEW":
        if correct and stable:
            state["learning_state"] = "REVIEW"
            interval = float(cfg["review_initial_days"])
            streak = 1
            reason = "FIRST_EVIDENCE_STABLE_SUCCESS"
        else:
            state["learning_state"] = "LEARNING"
            streak = 1 if correct else 0
            interval = _learning_interval(streak or 1, cfg)
            reason = "FIRST_EVIDENCE_START_LEARNING"
    elif previous == "LEARNING":
        if correct and stable:
            state["learning_state"] = "REVIEW"
            interval = float(cfg["review_initial_days"])
            streak += 1
            reason = "STABLE_SUCCESS_ENTER_REVIEW"
        elif correct:
            state["learning_state"] = "LEARNING"
            streak += 1
            interval = _learning_interval(streak, cfg)
            reason = "UNSTABLE_SUCCESS_CONTINUE_LEARNING"
        else:
            state["learning_state"] = "LEARNING"
            streak = 0
            interval = float(cfg["learning_intervals_days"][0])
            reason = "LEARNING_ERROR_RESET_SHORT"
    elif previous == "REVIEW":
        if correct and stable:
            state["learning_state"] = "REVIEW"
            interval = min(
                max(float(cfg["review_initial_days"]), interval * float(cfg["review_growth_factor"])),
                float(cfg["max_review_interval_days"]),
            )
            streak += 1
            reason = "STABLE_REVIEW_SUCCESS_EXPAND_INTERVAL"
        elif correct:
            state["learning_state"] = "LEARNING"
            streak = 1
            interval = float(cfg["learning_intervals_days"][-1])
            reason = "CORRECT_BUT_UNSTABLE_RETURN_LEARNING"
        else:
            state["learning_state"] = "LAPSED"
            streak = 0
            lapse_count += 1
            lapse = cfg["lapse"]
            interval = max(
                float(lapse["min_days"]),
                min(float(lapse["max_days"]), interval * float(lapse["interval_multiplier"])),
            )
            reason = "WRONG_AFTER_MASTERY_LAPSE"
    elif previous == "LAPSED":
        if correct and stable:
            state["learning_state"] = "REVIEW"
            streak = 1
            interval = float(cfg["lapse"]["recovery_days"])
            reason = "LAPSE_RECOVERY_STABLE_SUCCESS"
        elif correct:
            state["learning_state"] = "LEARNING"
            streak = 1
            interval = float(cfg["learning_intervals_days"][0])
            reason = "LAPSE_RECOVERY_UNSTABLE_LEARNING"
        else:
            state["learning_state"] = "LAPSED"
            streak = 0
            interval = float(cfg["lapse"]["min_days"])
            reason = "LAPSED_ERROR_KEEP_SHORT"
    else:  # pragma: no cover - guarded above
        raise ValueError("S17_UNHANDLED_STATE")

    state["interval_days"] = round(interval, 4)
    state["due_at"] = _due(event_at, interval)
    state["success_streak"] = streak
    state["lapse_count"] = lapse_count
    state["last_answer_id"] = event.get("answer_id")
    state["transition_reason"] = reason
    state["scheduler_version"] = cfg["scheduler_version"]
    return state


def queue_status(item: Dict[str, Any], as_of: Any) -> str:
    if item.get("learning_state") == "SUSPENDED":
        return "SUSPENDED"
    if not item.get("due_at"):
        return "SCHEDULED"
    return "DUE" if parse_dt(item["due_at"]) <= parse_dt(as_of) else "SCHEDULED"


def rank_due(items: Iterable[Dict[str, Any]], as_of: Any) -> List[Dict[str, Any]]:
    now = parse_dt(as_of)
    state_rank = {"LAPSED": 0, "LEARNING": 1, "REVIEW": 2, "NEW": 3}
    eligible = [
        deepcopy(x)
        for x in items
        if x.get("learning_state") != "SUSPENDED"
        and x.get("due_at")
        and parse_dt(x["due_at"]) <= now
    ]
    return sorted(
        eligible,
        key=lambda x: (
            parse_dt(x["due_at"]),
            state_rank.get(x.get("learning_state"), 9),
            0 if x.get("marked_signal") else 1,
            str(x.get("subtopic_id", "")),
        ),
    )


def build_question_selection_handoff(
    subtopic_id: str,
    recent_history_newest_first: Iterable[Dict[str, Any]],
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Contract for Stage14/serving: due concept, not a frozen repeated sentence."""
    cfg = DEFAULT_CONFIG if config is None else config
    validate_config(cfg)
    window = int(cfg["diversity"]["recent_question_uid_window"])
    seen: List[str] = []
    for row in recent_history_newest_first:
        uid = row.get("question_uid")
        if uid and uid not in seen:
            seen.append(str(uid))
        if len(seen) >= window:
            break
    return {
        "target_scope": "SUBTOPIC",
        "subtopic_id": subtopic_id,
        "hard_requirements": {
            "question_status": "PUBLISHED",
            "exclude_retired_or_disabled": True,
            "exclude_confirmed_content_issue": True,
        },
        "soft_excluded_question_uids": seen,
        "soft_exclusion_relaxable_if_pool_empty": bool(
            cfg["diversity"]["relax_soft_exclusion_if_pool_exhausted"]
        ),
        "hard_exclusions_relaxable": False,
        "scheduler_version": cfg["scheduler_version"],
    }

from __future__ import annotations
import hashlib

ALLOWED={"delayed_correct_rate_7d","delayed_correct_rate_14d","repeat_error_rate","mastery_gain","review_recovery_rate"}

def validate_experiment_plan(plan, config):
    errors=[]
    if plan.get("primary_metric") not in ALLOWED: errors.append("primary_metric must be a predeclared learning metric")
    if not plan.get("guardrails"): errors.append("at least one guardrail is required")
    if plan.get("baseline_model_version")==plan.get("candidate_model_version"): errors.append("baseline and candidate versions must differ")
    share=plan.get("candidate_traffic_share",0)
    if not (0 < share <= config["experiments"]["max_candidate_traffic_share"]): errors.append("candidate_traffic_share out of allowed range")
    if plan.get("minimum_duration_days",0) < config["experiments"]["minimum_duration_days"]: errors.append("minimum duration too short")
    if plan.get("minimum_observations_per_arm",0) < config["experiments"]["minimum_observations_per_arm"]: errors.append("minimum observations per arm too low")
    return errors

def assign_experiment_arm(subject_pseudonymous_key, experiment_slug, candidate_traffic_share=0.10):
    """Deterministic assignment. Caller must pass a pseudonymous/salted subject key, not email/name."""
    digest=hashlib.sha256(f"{experiment_slug}:{subject_pseudonymous_key}".encode()).digest()
    u=int.from_bytes(digest[:8],"big")/(2**64)
    return "CANDIDATE" if u < candidate_traffic_share else "BASELINE"

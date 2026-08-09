from __future__ import annotations

def evaluate_question_quality(metrics, config):
    gates=config["sample_gates"]; t=config["initial_review_thresholds"]
    n=metrics.get("sample_size",0) or 0
    flags=[]
    def add(code,severity,action,detail): flags.append({"code":code,"severity":severity,"action":action,"detail":detail})
    if n < gates["review_min_n"]:
        add("S27_INSUFFICIENT_SAMPLE","INFO","COLLECT_MORE_DATA",f"N={n}; no content/difficulty decision is permitted")
        return flags
    correct_id=metrics.get("correct_option_id")
    for option_id,share in (metrics.get("option_distribution") or {}).items():
        if option_id != correct_id and share < t["weak_distractor_selection_rate_below"]:
            add("S27_WEAK_DISTRACTOR","MEDIUM","OPEN_REVIEW",f"option {option_id} share={share:.3f}")
    d=metrics.get("discrimination")
    if d is not None and d < t["negative_discrimination_below"]:
        add("S27_NEGATIVE_DISCRIMINATION","CRITICAL","QA_FIRST",f"discrimination={d:.3f}")
    elif d is not None and n>=gates["decision_min_n"] and d <= t["low_discrimination_at_or_below"]:
        add("S27_LOW_DISCRIMINATION","HIGH","OPEN_REVIEW",f"discrimination={d:.3f}")
    report=metrics.get("report_rate")
    if report is not None and report >= t["high_report_rate_at_or_above"]:
        add("S27_HIGH_REPORT_RATE","HIGH","OPEN_REVIEW",f"report_rate={report:.3f}")
    repeat=metrics.get("repeat_error_rate")
    if repeat is not None and repeat >= t["high_repeat_error_rate_at_or_above"]:
        add("S27_REPEAT_ERROR","MEDIUM","EDUCATIONAL_REVIEW",f"repeat_error_rate={repeat:.3f}")
    cr=metrics.get("correct_rate")
    if n>=gates["decision_min_n"] and cr is not None:
        if cr <= t["extreme_hard_correct_rate_at_or_below"]:
            add("S27_EXTREME_LOW_CORRECT_RATE","HIGH","REVIEW_DIFFICULTY_AND_CONTENT",f"correct_rate={cr:.3f}; do not auto-label VERY_HARD")
        elif cr >= t["extreme_easy_correct_rate_at_or_above"]:
            add("S27_EXTREME_HIGH_CORRECT_RATE","MEDIUM","REVIEW_DIFFICULTY",f"correct_rate={cr:.3f}")
    codes={f["code"] for f in flags}
    if n>=gates["decision_min_n"] and "S27_EXTREME_LOW_CORRECT_RATE" in codes and "S27_HIGH_REPORT_RATE" in codes:
        add("S27_AMBIGUITY_CANDIDATE","CRITICAL","CONTENT_QA_BEFORE_DIFFICULTY", "low correctness + elevated reports; review content before changing difficulty")
    if n>=gates["decision_min_n"] and ("S27_NEGATIVE_DISCRIMINATION" in codes or "S27_AMBIGUITY_CANDIDATE" in codes):
        add("S27_RETIREMENT_CANDIDATE","HIGH","HUMAN_REVIEW_REQUIRED", "candidate only; retirement must use Stage11 workflow and preserve history")
    return flags

from __future__ import annotations
from .rules import evaluate_question_quality

def build_quality_row(question_id, metrics, config):
    flags=evaluate_question_quality(metrics,config)
    severity_rank={"CRITICAL":0,"HIGH":1,"MEDIUM":2,"INFO":3}
    flags=sorted(flags,key=lambda x:(severity_rank.get(x["severity"],9),x["code"]))
    return {"question_id":str(question_id),**metrics,"flags":flags,"needs_review":any(f["action"] not in {"COLLECT_MORE_DATA"} for f in flags)}

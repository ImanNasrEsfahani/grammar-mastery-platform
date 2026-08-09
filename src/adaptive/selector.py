from __future__ import annotations
import hashlib, math
from copy import deepcopy
SCORE_MODEL_VERSION="adaptive-score-v0.9.0"; SELECTOR_VERSION="adaptive-selector-v0.9.0"; CONFIG_SCHEMA_VERSION="adaptive-selection-config-v0.9.0"
DIFFICULTY_NORM={"EASY":0.0,"MEDIUM":1/3,"HARD":2/3,"VERY_HARD":1.0}
DEFAULT_CONFIG={"schema_version":CONFIG_SCHEMA_VERSION,"mode":"adaptive","question_count":10,"weights":{"tcf":.20,"mastery_gap":.30,"review_urgency":.20,"novelty":.15,"misconception_need":.15},"normalization":{"tcf_max_weight_pct":2.48,"mastery_prior_gap":.50,"review_overdue_full_days":14.,"novelty_full_days":14.,"misconception_repeat_full_count":3.},"cooldown":{"days":7,"allow_recent_if_shortage":False},"exploration":{"share":.15},"diversity":{"max_lesson_share":.35,"max_type_share":.40,"strict":True},"difficulty":{"fit_floor":.75,"weak_gap_threshold":.70,"weak_max_difficulty":"MEDIUM","developing_gap_threshold":.45,"developing_max_difficulty":"HARD"},"seed":"stage14-reference-seed-v0.9"}
class AdaptiveSelectionError(Exception):
    def __init__(self,code,message,detail=None):super().__init__(message);self.code=code;self.detail=detail or {}
def clamp(x):return max(0.,min(1.,float(x)))
def validate_config(c=None):
    cfg=deepcopy(DEFAULT_CONFIG)
    for k,v in (c or {}).items():
        if k in {"weights","normalization","cooldown","exploration","diversity","difficulty"}:cfg[k].update(v)
        else:cfg[k]=v
    if cfg["mode"]!="adaptive" or cfg["question_count"]<1 or abs(sum(cfg["weights"].values())-1)>1e-9:raise AdaptiveSelectionError("CONFIG_INVALID","invalid config")
    return cfg
def stage13_eligible(x):
    comp=x.get("compatibility_status","ALLOWED")
    return x.get("status")=="PUBLISHED" and x.get("is_current_revision",True) and x.get("serving_enabled",True) and x.get("in_scope",True) and not x.get("blocked_not_scorable",False) and (comp in {"PREFERRED","ALLOWED"} or (comp=="CONDITIONAL" and x.get("conditional_guardrail_passed",False)))
def score_candidate(x,c=None):
    cfg=validate_config(c);n=cfg["normalization"];w=cfg["weights"]
    tcf=clamp(float(x.get("tcf_weight_pct",0))/n["tcf_max_weight_pct"])
    if "mastery_gap_input" in x:raw=clamp(x["mastery_gap_input"]);conf=clamp(x.get("mastery_confidence",1))
    elif "mastery_score_pct" in x:raw=1-clamp(float(x["mastery_score_pct"])/100);conf=clamp(x.get("mastery_confidence",0))
    else:raw=n["mastery_prior_gap"];conf=0
    gap=clamp(conf*raw+(1-conf)*n["mastery_prior_gap"])
    urg=clamp(x.get("review_urgency_input",max(0,float(x.get("days_overdue",0)))/n["review_overdue_full_days"]))
    seen=x.get("days_since_seen");nov=1.0 if seen is None else clamp(max(0,float(seen))/n["novelty_full_days"])
    mis=clamp(max(0,float(x.get("misconception_repeat_count",0)))/n["misconception_repeat_full_count"])
    comps={"tcf":tcf,"mastery_gap":gap,"review_urgency":urg,"novelty":nov,"misconception_need":mis};base=sum(w[k]*comps[k] for k in comps)
    d=x.get("difficulty","MEDIUM");ready=1-gap;fit=clamp(1-abs(DIFFICULTY_NORM[d]-ready));mult=cfg["difficulty"]["fit_floor"]+(1-cfg["difficulty"]["fit_floor"])*fit
    if gap>=cfg["difficulty"]["weak_gap_threshold"]:mx=cfg["difficulty"]["weak_max_difficulty"]
    elif gap>=cfg["difficulty"]["developing_gap_threshold"]:mx=cfg["difficulty"]["developing_max_difficulty"]
    else:mx="VERY_HARD"
    return {"components":comps,"base_score":base,"adjusted_score":base*mult,"difficulty_fit":fit,"difficulty_max_allowed":mx,"difficulty_guardrail_pass":DIFFICULTY_NORM[d]<=DIFFICULTY_NORM[mx],"mastery_raw_gap":raw,"mastery_confidence":conf}
def exploration_slots(n,share,seed):
    count=min(n,int(math.floor(n*share+.5)));count=max(count,1) if n>=5 and share>0 else count
    rank=sorted(range(n),key=lambda i:hashlib.sha256(f"{seed}|slot|{i}".encode()).hexdigest());return sorted(rank[:count])
def select_adaptive(c,candidates):
    cfg=validate_config(c);eligible=[dict(x) for x in candidates if stage13_eligible(x)]
    if not eligible:raise AdaptiveSelectionError("NO_ELIGIBLE_QUESTIONS","no safe published candidate")
    cooldown=[x for x in eligible if x.get("days_since_seen") is None or float(x["days_since_seen"])>=cfg["cooldown"]["days"]]
    pool=cooldown if len(cooldown)>=cfg["question_count"] or not cfg["cooldown"]["allow_recent_if_shortage"] else eligible
    scored=[]
    for x in pool:
        s=score_candidate(x,cfg)
        if s["difficulty_guardrail_pass"]:scored.append((s["adjusted_score"],hashlib.sha256(f"{cfg['seed']}|{x['question_revision_id']}".encode()).hexdigest(),x,s))
    scored.sort(key=lambda z:(-z[0],z[1]));sel=[];lc={};tc={};lcap=max(1,math.ceil(cfg["question_count"]*cfg["diversity"]["max_lesson_share"]));tcap=max(1,math.ceil(cfg["question_count"]*cfg["diversity"]["max_type_share"]))
    for _,_,x,s in scored:
        if len(sel)>=cfg["question_count"]:break
        l=x.get("lesson_id");t=x.get("question_type_code")
        if lc.get(l,0)>=lcap or tc.get(t,0)>=tcap:continue
        x["selection_meta"]={"score":s,"selector_version":SELECTOR_VERSION};sel.append(x);lc[l]=lc.get(l,0)+1;tc[t]=tc.get(t,0)+1
    if len(sel)<cfg["question_count"]:raise AdaptiveSelectionError("DIVERSITY_CAP_INFEASIBLE","not enough candidates under strict caps",{"selected":len(sel)})
    digest=hashlib.sha256("|".join(x["question_revision_id"] for x in sel).encode()).hexdigest();return {"selected":sel,"selection_digest":digest,"exploration_slots":exploration_slots(len(sel),cfg["exploration"]["share"],cfg["seed"])}

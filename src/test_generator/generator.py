from __future__ import annotations
import hashlib, math, secrets
from collections import defaultdict, deque
GENERATOR_VERSION="test-generator-v0.9.0"; CONFIG_SCHEMA_VERSION="test-config-schema-v0.9.0"
DIFFICULTIES=("EASY","MEDIUM","HARD","VERY_HARD")
ADJACENT={"EASY":["MEDIUM"],"MEDIUM":["EASY","HARD"],"HARD":["MEDIUM","VERY_HARD"],"VERY_HARD":["HARD"]}
class GeneratorError(Exception):
    def __init__(self,code,message,detail=None): super().__init__(message); self.code=code; self.detail=detail or {}
def _digest(*parts): return hashlib.sha256("|".join(map(str,parts)).encode()).hexdigest()
def largest_remainder(total,weights,stable_order=None):
    keys=list(stable_order or sorted(weights)); vals={k:float(weights.get(k,0)) for k in keys}; s=sum(vals.values())
    if total<0 or any(v<0 for v in vals.values()) or (total and s<=0): raise ValueError("invalid weights")
    if total==0:return {k:0 for k in keys}
    exp={k:total*vals[k]/s for k in keys}; out={k:int(math.floor(exp[k])) for k in keys}
    for k in sorted(keys,key=lambda k:(-(exp[k]-out[k]),str(k)))[:total-sum(out.values())]:out[k]+=1
    return out
def _sum100(m): return abs(sum(float(v) for v in m.values())-100)<1e-9
def validate_config(c):
    if c.get("schema_version")!=CONFIG_SCHEMA_VERSION or int(c.get("question_count",0))<1: raise GeneratorError("CONFIG_INVALID","schema/count")
    if c.get("mode")=="adaptive":raise GeneratorError("MODE_DEFERRED_STAGE14","adaptive belongs Stage14")
    if c.get("mode")=="review":raise GeneratorError("MODE_DEFERRED_STAGE16","review belongs Stage16")
    if c.get("mode") not in {"custom","tcf"}:raise GeneratorError("CONFIG_INVALID","mode")
    if set(c.get("difficulty_mix_pct",{}))!=set(DIFFICULTIES) or not _sum100(c["difficulty_mix_pct"]):raise GeneratorError("CONFIG_INVALID","difficulty mix")
    if c["mode"]=="tcf" and c.get("lesson_allocation",{}).get("strategy")!="TCF_WEIGHTED":raise GeneratorError("CONFIG_INVALID","tcf allocation")
    if not c.get("scope",{}).get("clauses") or c["scope"].get("combine") not in {"AND","OR"}:raise GeneratorError("CONFIG_INVALID","scope")
    return True
def _matches_scope(x,s):
    ans=[]; tags=set(x.get("tag_ids",[]))
    for cl in s["clauses"]:
        ids=set(cl["ids"]); d=cl["dimension"]
        ok=x.get({"LESSON":"lesson_id","SUBTOPIC":"subtopic_id","CATEGORY":"category_id","SUBCATEGORY":"subcategory_id"}.get(d,"__")) in ids if d!="TAG" else ((ids<=tags) if cl.get("tag_match","ANY")=="ALL" else bool(ids&tags))
        ans.append(ok)
    return all(ans) if s["combine"]=="AND" else any(ans)
def eligible(x,c):
    if not _matches_scope(x,c["scope"]):return False
    if x.get("status")!="PUBLISHED" or not x.get("serving_enabled",False) or not x.get("is_current_revision",False) or x.get("blocked_not_scorable",False):return False
    comp=x.get("compatibility_status")
    return comp in {"PREFERRED","ALLOWED"} or (comp=="CONDITIONAL" and x.get("conditional_guardrail_passed",False))
def lesson_quotas(c,lessons,tcf=None):
    n=c["question_count"]; st=c["lesson_allocation"]["strategy"]
    if not lessons:raise GeneratorError("SCOPE_EMPTY","no lesson")
    if st=="UNIFORM":w={x:1 for x in lessons}
    elif st=="TCF_WEIGHTED":w={x:float((tcf or {}).get(x,0)) for x in lessons}
    elif st=="EXPLICIT_PCT":w={x:float(c["lesson_allocation"]["mix_pct"].get(x,0)) for x in lessons}
    else:raise GeneratorError("CONFIG_INVALID","lesson allocation")
    return largest_remainder(n,w,lessons)
def matrix_round_exact(rows,cols,wfun):
    if sum(rows.values())!=sum(cols.values()):raise GeneratorError("QUOTA_INFEASIBLE","margins")
    R=list(rows); C=list(cols); N=sum(rows.values()); S=0; r0=1; c0=1+len(R); T=c0+len(C); size=T+1; cap=[[0]*size for _ in range(size)]; adj=[[] for _ in range(size)]
    def edge(u,v,z):adj[u].append(v);adj[v].append(u);cap[u][v]=z
    for i,r in enumerate(R):edge(S,r0+i,rows[r])
    for j,c in enumerate(C):edge(c0+j,T,cols[c])
    for i,r in enumerate(R):
        for c in sorted(C,key=lambda c:(-float(wfun(r,c)),str(c))):
            if wfun(r,c)>0:edge(r0+i,c0+C.index(c),N)
    flow=0
    while True:
        par=[-1]*size;par[S]=S;q=deque([S])
        while q and par[T]<0:
            u=q.popleft()
            for v in adj[u]:
                if par[v]<0 and cap[u][v]>0:par[v]=u;q.append(v)
        if par[T]<0:break
        f=10**9;v=T
        while v!=S:f=min(f,cap[par[v]][v]);v=par[v]
        v=T
        while v!=S:u=par[v];cap[u][v]-=f;cap[v][u]+=f;v=u
        flow+=f
    if flow!=N:raise GeneratorError("QUOTA_INFEASIBLE","compatibility",{"required":N,"flow":flow})
    return {(r,c):cap[c0+j][r0+i] for i,r in enumerate(R) for j,c in enumerate(C) if cap[c0+j][r0+i]}
def generate_plan(c,candidates,tcf_weights=None,type_weights=None):
    validate_config(c); pool=[dict(x) for x in candidates if eligible(x,c)]
    if not pool:raise GeneratorError("NO_ELIGIBLE_QUESTIONS","no published serving-compatible item")
    lessons=sorted({x["lesson_id"] for x in pool}); lq=lesson_quotas(c,lessons,tcf_weights); dq=largest_remainder(c["question_count"],c["difficulty_mix_pct"],DIFFICULTIES)
    n=c["question_count"]; ldm=matrix_round_exact(lq,dq,lambda l,d:(lq[l]/n)*(dq[d]/n))
    if c["type_allocation"]["strategy"]=="EXPLICIT_PCT":tq=largest_remainder(n,c["type_allocation"]["mix_pct"])
    else:
        glob=defaultdict(float)
        for l,count in lq.items():
            local=(type_weights or {}).get(l,{}); s=sum(max(0,float(v)) for v in local.values())
            if count and s<=0:raise GeneratorError("QUOTA_INFEASIBLE","no type weights",{"lesson_id":l})
            for t,v in local.items():glob[t]+=count*max(0,float(v))/s
        tq=largest_remainder(n,glob)
    strata=matrix_round_exact(ldm,tq,lambda ld,t:float((type_weights or {}).get(ld[0],{}).get(t,0)) if c["type_allocation"]["strategy"]!="EXPLICIT_PCT" else float(c["type_allocation"]["mix_pct"].get(t,0)))
    return {"seed":str(c.get("seed") or secrets.token_hex(16)),"lesson_quotas":lq,"difficulty_quotas":dq,"type_quotas":tq,"strata":{f"{l}|{d}|{t}":v for ((l,d),t),v in strata.items()},"generator_version":GENERATOR_VERSION}

from __future__ import annotations
from collections import defaultdict
from datetime import datetime,timedelta,timezone
import math
DEFAULT_CONFIG={"model_version":"mastery-evidence-v0.9.0","provider_contract_version":"mastery-provider-contract-v0.9.0","prior_score_pct":50.,"recency_half_life_days":45.,"difficulty_weights":{"EASY":.8,"MEDIUM":1.,"HARD":1.2,"VERY_HARD":1.4},"misconception":{"repeat_window_days":90.,"increment":.15,"max_extra":.45},"confidence":{"evidence_scale":12.,"stability_floor":.75,"stability_share":.25,"max":.99},"stability":{"min_evidence_count":4,"recent_answer_count":5,"full_divergence_pct_points":40.},"thresholds":{"weak_below":55.,"strong_at_or_above":80.,"min_confidence_for_label":.45}}
def clamp(x,a,b):return max(a,min(b,x))
def dt(x):
    y=x if isinstance(x,datetime) else datetime.fromisoformat(str(x).replace('Z','+00:00'));return y if y.tzinfo else y.replace(tzinfo=timezone.utc)
def validate_config(c):
    if not c.get('model_version') or c['recency_half_life_days']<=0:raise ValueError('INVALID_CONFIG')
    if set(c['difficulty_weights'])!={'EASY','MEDIUM','HARD','VERY_HARD'} or any(v<=0 for v in c['difficulty_weights'].values()):raise ValueError('INVALID_DIFFICULTY_CONFIG')
    t=c['thresholds']
    if not 0<=t['weak_below']<t['strong_at_or_above']<=100:raise ValueError('CONFIG_THRESHOLD_ORDER_INVALID')
def latest(evidence):
    m={}
    for x in evidence:
        if x.get('is_correct') is None:continue
        k=(x.get('attempt_id'),x.get('test_question_id'));seq=int(x.get('answer_sequence',1))
        if k not in m or seq>int(m[k].get('answer_sequence',1)):m[k]=x
    return sorted(m.values(),key=lambda x:(dt(x['answered_at']),str(x.get('answer_id',''))))
def compute_subtopic_mastery(evidence,as_of,config=None):
    c=config or DEFAULT_CONFIG;validate_config(c);items=latest(evidence);prior=c['prior_score_pct']
    if not items:return {'evidence_score_pct':prior,'mastery_score_pct':prior,'confidence':0.,'evidence_count':0,'effective_evidence':0.,'stability':.5,'coverage_ratio':0.,'mastery_band':'NO_EVIDENCE','last_evidence_at':None,'model_version':c['model_version'],'details':[]}
    hist=defaultdict(list);num=den=eff=0.;details=[];asof=dt(as_of)
    for x in items:
        d=str(x['difficulty_code']).upper()
        if d not in c['difficulty_weights']:raise ValueError('UNKNOWN_DIFFICULTY:'+d)
        when=dt(x['answered_at']);age=max(0.,(asof-when).total_seconds()/86400);rec=2**(-age/c['recency_half_life_days']);dw=c['difficulty_weights'][d];base=rec*dw;mult=1.;mid=x.get('misconception_id')
        if not x['is_correct'] and mid:
            cutoff=when-timedelta(days=c['misconception']['repeat_window_days']);prev=[z for z in hist[str(mid)] if z>=cutoff];mult=1+min(c['misconception']['max_extra'],c['misconception']['increment']*len(prev));hist[str(mid)].append(when)
        sw=base*mult;num+=sw*(1 if x['is_correct'] else 0);den+=sw;eff+=base;details.append({'answer_id':x.get('answer_id'),'is_correct':bool(x['is_correct']),'difficulty_code':d,'score_weight':sw,'base_weight':base,'misconception_id':mid,'misconception_multiplier':mult,'response_ms':x.get('response_ms'),'response_time_applied_to_score':False})
    evid=100*num/den if den else prior
    if len(details)<c['stability']['min_evidence_count']:st=.5
    else:
        r=details[-c['stability']['recent_answer_count']:];rd=sum(z['score_weight'] for z in r);rn=sum(z['score_weight']*(1 if z['is_correct'] else 0) for z in r);recent=100*rn/rd if rd else evid;st=1-clamp(abs(recent-evid)/c['stability']['full_divergence_pct_points'],0,1)
    sample=1-math.exp(-eff/c['confidence']['evidence_scale']);conf=clamp(sample*(c['confidence']['stability_floor']+c['confidence']['stability_share']*st),0,c['confidence']['max']);master=prior+conf*(evid-prior)
    band='UNCERTAIN' if conf<c['thresholds']['min_confidence_for_label'] else ('WEAK' if master<c['thresholds']['weak_below'] else ('STRONG' if master>=c['thresholds']['strong_at_or_above'] else 'DEVELOPING'))
    return {'evidence_score_pct':round(evid,6),'mastery_score_pct':round(master,6),'confidence':round(conf,9),'evidence_count':len(details),'effective_evidence':round(eff,9),'stability':round(st,9),'coverage_ratio':1.,'mastery_band':band,'last_evidence_at':dt(items[-1]['answered_at']).isoformat(),'model_version':c['model_version'],'details':details}
def aggregate_mastery(children,weights=None,config=None):
    c=config or DEFAULT_CONFIG;prior=c['prior_score_pct'];w=list(weights or [1.]*len(children))
    if not children:return {'evidence_score_pct':prior,'mastery_score_pct':prior,'confidence':0.,'evidence_count':0,'effective_evidence':0.,'stability':.5,'coverage_ratio':0.,'mastery_band':'NO_EVIDENCE','model_version':c['model_version']}
    total=sum(w);obs=[(x,z) for x,z in zip(children,w) if int(x.get('evidence_count',0))>0];evid=sum(x['evidence_score_pct']*z for x,z in obs)/sum(z for _,z in obs) if obs else prior;conf=sum(x.get('confidence',0)*z for x,z in zip(children,w))/total;coverage=sum((1 if x.get('evidence_count',0)>0 else 0)*z for x,z in zip(children,w))/total;st=sum(x.get('stability',.5)*z for x,z in zip(children,w))/total;master=prior+conf*(evid-prior);count=sum(int(x.get('evidence_count',0)) for x in children);eff=sum(float(x.get('effective_evidence',0)) for x in children)
    band='NO_EVIDENCE' if count==0 else ('UNCERTAIN' if conf<c['thresholds']['min_confidence_for_label'] else ('WEAK' if master<c['thresholds']['weak_below'] else ('STRONG' if master>=c['thresholds']['strong_at_or_above'] else 'DEVELOPING')))
    return {'evidence_score_pct':round(evid,6),'mastery_score_pct':round(master,6),'confidence':round(conf,9),'evidence_count':count,'effective_evidence':round(eff,9),'stability':round(st,9),'coverage_ratio':round(coverage,9),'mastery_band':band,'model_version':c['model_version']}
def stage14_provider_payload(r):return {'mastery_score_pct':r['evidence_score_pct'],'confidence':r['confidence'],'source':'STAGE15_EVIDENCE_SCORE','stage15_final_mastery_score_pct':r['mastery_score_pct'],'mastery_model_version':r.get('model_version',DEFAULT_CONFIG['model_version']),'provider_contract_version':DEFAULT_CONFIG['provider_contract_version']}

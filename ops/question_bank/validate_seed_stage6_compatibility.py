#!/usr/bin/env python3
"""Fail-closed static Stage6 compatibility preflight for repository Question Bank seeds.
No DB writes; no Stage23 import/preview/commit.
"""
from __future__ import annotations
import csv, json, sys
from pathlib import Path
STAGE23='STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT'
ROOT=Path(__file__).resolve().parents[2]
CAT=ROOT/'data/question_bank/full/v1.0/master/question_bank_seed_catalog.json'
COMPAT=ROOT/'data/question_authoring/stage6/stage6_subtopic_type_compatibility_recovered_v1.0.csv'

def read_csv(p):
    with p.open(encoding='utf-8-sig',newline='') as f: return list(csv.DictReader(f))

def main():
    catalog=json.loads(CAT.read_text(encoding='utf-8'))
    rows=[]
    for rel in catalog['sources']: rows += read_csv(ROOT/rel)
    compat={(r['subtopic_id'],r['question_type_code']):r for r in read_csv(COMPAT)}
    not_suitable=[]; missing=[]; conditional=[]
    for q in rows:
        rule=compat.get((q['subtopic_id'],q['question_type']))
        if rule is None:
            missing.append({'external_id':q['external_id'],'subtopic_code':q['subtopic_code'],'question_type':q['question_type']}); continue
        status=rule['compatibility_status'].strip()
        if status=='NOT_SUITABLE':
            not_suitable.append({'external_id':q['external_id'],'subtopic_code':q['subtopic_code'],'question_type':q['question_type'],'rationale_fa':rule.get('rationale_fa','')})
        elif status=='CONDITIONAL':
            # Bootstrap stores guardrail_satisfied for CONDITIONAL after validated repository consolidation.
            # Static preflight therefore surfaces every CONDITIONAL row for explicit evidence review.
            conditional.append({'external_id':q['external_id'],'subtopic_code':q['subtopic_code'],'question_type':q['question_type'],'guardrail_required':rule.get('conditional_guardrail_required',''),'rationale_fa':rule.get('rationale_fa','')})
    result={
      'status':'PASS' if not not_suitable and not missing else 'FAIL',
      'question_count':len(rows),
      'not_suitable_count':len(not_suitable),
      'missing_rule_count':len(missing),
      'conditional_count_for_explicit_review':len(conditional),
      'not_suitable':not_suitable,'missing_rules':missing,'conditional':conditional,
      'stage23':STAGE23,'stage23_runtime_executed':False
    }
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 0 if result['status']=='PASS' else 2
if __name__=='__main__': raise SystemExit(main())

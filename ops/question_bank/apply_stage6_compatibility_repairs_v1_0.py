#!/usr/bin/env python3
"""Apply the two reviewed B086 repairs by external_id to the repository seed source.
Atomic, fail-closed, preserves all unrelated rows. No Git/GitHub writes and no Stage23 execution.
"""
from __future__ import annotations
import csv, json, os, shutil, sys, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
REPAIRS=ROOT/'data/question_bank/full/v1.0/repairs/stage6_compatibility_repairs_B086_v1.0.csv'
CAT=ROOT/'data/question_bank/full/v1.0/master/question_bank_seed_catalog.json'
TARGET_IDS={'GMP-FULL-B086-Q028','GMP-FULL-B086-Q029'}
EXPECTED_OLD={
 'GMP-FULL-B086-Q028':('L19-S04','PREPOSITION_CHOICE','EASY'),
 'GMP-FULL-B086-Q029':('L19-S05','PREPOSITION_CHOICE','MEDIUM'),
}
def load(p):
    with p.open(encoding='utf-8-sig',newline='') as f:
        r=csv.DictReader(f); return list(r.fieldnames or []),list(r)
def main():
    rh,rr=load(REPAIRS); rmap={r['external_id']:r for r in rr}
    if set(rmap)!=TARGET_IDS: raise SystemExit('REPAIR_SET_DRIFT')
    cat=json.loads(CAT.read_text(encoding='utf-8'))
    located={}
    for rel in cat['sources']:
        p=ROOT/rel; h,rows=load(p)
        if h!=rh: raise SystemExit(f'SCHEMA_DRIFT: {rel}')
        for i,row in enumerate(rows):
            qid=row['external_id']
            if qid in TARGET_IDS:
                if qid in located: raise SystemExit(f'DUPLICATE_TARGET: {qid}')
                located[qid]=(p,h,rows,i,row)
    if set(located)!=TARGET_IDS: raise SystemExit(f'TARGET_NOT_FOUND: {sorted(TARGET_IDS-set(located))}')
    # Ensure we are patching the known incident, not silently overwriting unrelated newer content.
    for qid,(p,h,rows,i,old) in located.items():
        expected=EXPECTED_OLD[qid]
        now=(old['subtopic_code'],old['question_type'],old['difficulty'])
        if now==('L19-S03','PREPOSITION_CHOICE',expected[2]):
            continue  # already repaired
        if now!=expected: raise SystemExit(f'UNEXPECTED_PREIMAGE {qid}: {now!r}')
    changed=[]
    bypath={}
    for qid,(p,h,rows,i,old) in located.items():
        bypath.setdefault(p,(h,rows)); rows[i]=rmap[qid]; changed.append(qid)
    for p,(h,rows) in bypath.items():
        fd,tmp=tempfile.mkstemp(prefix=p.name+'.',suffix='.tmp',dir=p.parent); os.close(fd)
        tp=Path(tmp)
        try:
            with tp.open('w',encoding='utf-8-sig',newline='') as f:
                w=csv.DictWriter(f,fieldnames=h); w.writeheader(); w.writerows(rows)
            os.replace(tp,p)
        finally:
            if tp.exists(): tp.unlink()
    print(json.dumps({'status':'APPLIED','repaired':sorted(changed),'stage23':'STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT','stage23_runtime_executed':False},ensure_ascii=False,indent=2))
    print('\nNEXT: python ops/question_bank/validate_seed_stage6_compatibility.py')
    return 0
if __name__=='__main__': raise SystemExit(main())

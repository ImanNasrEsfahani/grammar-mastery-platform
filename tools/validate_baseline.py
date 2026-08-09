from pathlib import Path
import csv,json,re,subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
def rows(p):
 with open(ROOT/p,encoding='utf-8-sig') as f:return list(csv.DictReader(f))
w=rows('data/planning/stage3_lesson_weights_v1.0.csv');assert len(w)==52 and round(sum(float(x['final_weight_pct']) for x in w),2)==100
t=rows('data/planning/stage4_lesson_targets_v1.0.csv');assert sum(int(x['target_full']) for x in t)==10636 and sum(int(x['target_expanded']) for x in t)==5331 and sum(int(x['target_mvp']) for x in t)==2666
d=rows('data/planning/stage9_lesson_difficulty_targets_v1.0.csv');assert len(d)==52 and [sum(int(x[k]) for x in d) for k in ['easy_full','medium_full','hard_full','very_hard_full']]==[2180,4116,3203,1137]
sql=(ROOT/'database/postgres/001_stage12_schema_v0.9.sql').read_text();assert len(re.findall(r'CREATE TABLE IF NOT EXISTS',sql))==49
json.load(open(ROOT/'schemas/question_import.schema.json'))
print('BASELINE_DATA_VALIDATION=PASS')

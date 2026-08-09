from pathlib import Path
import json, re, sys
ROOT=Path(__file__).resolve().parents[1]
errors=[]
required=[
 'config/stage27_calibration_contract_v1.0.json','schemas/stage27_experiment_v1.0.schema.json','database/postgres/008_stage27_calibration_v1.0.sql',
 'src/calibration/metrics.py','src/calibration/rules.py','src/calibration/experiments.py','docs/stages/stage27/question_quality_dashboard_v1.0.md','docs/stages/stage27/calibration_rules_v1.0.md','docs/stages/stage27/retirement_workflow_v1.0.md','docs/stages/stage27/model_versioning_v1.0.md','docs/stages/stage27/experiment_log_v1.0.csv']
for r in required:
    if not (ROOT/r).exists(): errors.append('missing:'+r)
config=json.loads((ROOT/'config/stage27_calibration_contract_v1.0.json').read_text())
if config.get('formal_ready') is not False: errors.append('formal_ready must stay false without live data')
if config['sample_gates']['review_min_n']!=100: errors.append('Stage7 weak-distractor N gate drifted')
if config['initial_review_thresholds']['weak_distractor_selection_rate_below']!=0.05: errors.append('Stage7 weak-distractor rate drifted')
sql=(ROOT/'database/postgres/008_stage27_calibration_v1.0.sql').read_text()
for token in ['question_metric_snapshots','calibration_model_versions','calibration_decisions','calibration_experiments','answer_calibration_context']:
    if token not in sql: errors.append('SQL missing '+token)
for forbidden in ['DELETE FROM user_answers','UPDATE user_answers','UPDATE mastery_snapshots','DROP TABLE questions']:
    if forbidden.lower() in sql.lower(): errors.append('destructive SQL:'+forbidden)
print(json.dumps({'stage':27,'status':'PASS' if not errors else 'FAIL','errors':errors},indent=2))
sys.exit(1 if errors else 0)

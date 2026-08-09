from pathlib import Path
import json
from src.calibration.metrics import compute_question_metrics
from src.calibration.dashboard import build_quality_row
ROOT=Path(__file__).resolve().parents[1]
config=json.loads((ROOT/'config/stage27_calibration_contract_v1.0.json').read_text())
fixture=json.loads((ROOT/'tests/fixtures/stage27/reference_events_v1.0.json').read_text())
metrics=compute_question_metrics(fixture['observations'],fixture['correct_option_id'],fixture['option_ids'],config['sample_gates']['discrimination_min_band_n'])
print(json.dumps(build_quality_row(fixture['question_id'],metrics,config),indent=2))

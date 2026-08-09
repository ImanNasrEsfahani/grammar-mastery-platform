import json, unittest
from pathlib import Path
from src.calibration.metrics import compute_question_metrics
from src.calibration.rules import evaluate_question_quality
from src.calibration.experiments import validate_experiment_plan, assign_experiment_arm
ROOT=Path(__file__).resolve().parents[1]
CONFIG=json.loads((ROOT/'config/stage27_calibration_contract_v1.0.json').read_text())
FIX=json.loads((ROOT/'tests/fixtures/stage27/reference_events_v1.0.json').read_text())

class Stage27Tests(unittest.TestCase):
  def test_roadmap_500_answer_case_routes_to_qa_not_auto_very_hard(self):
    m=compute_question_metrics(FIX['observations'],FIX['correct_option_id'],FIX['option_ids'])
    self.assertEqual(m['sample_size'],500); self.assertAlmostEqual(m['correct_rate'],.18,places=6)
    flags=evaluate_question_quality(m,CONFIG); codes={f['code'] for f in flags}
    self.assertIn('S27_WEAK_DISTRACTOR',codes); self.assertIn('S27_HIGH_REPORT_RATE',codes); self.assertIn('S27_EXTREME_LOW_CORRECT_RATE',codes); self.assertIn('S27_AMBIGUITY_CANDIDATE',codes)
    self.assertTrue(all('VERY_HARD' not in f['action'] for f in flags))
  def test_ten_answers_never_make_quality_decision(self):
    m=compute_question_metrics(FIX['observations'][:10],FIX['correct_option_id'],FIX['option_ids'])
    flags=evaluate_question_quality(m,CONFIG)
    self.assertEqual([f['code'] for f in flags],['S27_INSUFFICIENT_SAMPLE'])
  def test_weak_distractor_gate_is_n100(self):
    m=compute_question_metrics(FIX['observations'][:100],FIX['correct_option_id'],FIX['option_ids'])
    codes={f['code'] for f in evaluate_question_quality(m,CONFIG)}
    self.assertIn('S27_WEAK_DISTRACTOR',codes)
  def test_metrics_include_required_dimensions(self):
    m=compute_question_metrics(FIX['observations'],FIX['correct_option_id'],FIX['option_ids'])
    for k in ('sample_size','correct_rate','median_response_ms','p90_response_ms','option_distribution','discrimination','report_rate','repeat_error_rate'): self.assertIn(k,m)
  def test_experiment_plan_fails_without_learning_metric_guardrail(self):
    bad={'primary_metric':'questions_answered','guardrails':[],'baseline_model_version':'x','candidate_model_version':'x','candidate_traffic_share':.5,'minimum_duration_days':1,'minimum_observations_per_arm':10}
    self.assertGreaterEqual(len(validate_experiment_plan(bad,CONFIG)),5)
  def test_valid_limited_experiment(self):
    p={'primary_metric':'delayed_correct_rate_14d','guardrails':['report_rate','repeat_error_rate'],'baseline_model_version':'adaptive-score-v0.9.0','candidate_model_version':'adaptive-score-v0.10.0','candidate_traffic_share':.10,'minimum_duration_days':14,'minimum_observations_per_arm':200}
    self.assertEqual(validate_experiment_plan(p,CONFIG),[])
  def test_assignment_deterministic(self):
    self.assertEqual(assign_experiment_arm('hash-subject','exp',.1),assign_experiment_arm('hash-subject','exp',.1))
  def test_history_policy_is_fail_closed(self):
    h=CONFIG['historical_integrity']; self.assertFalse(h['rewrite_historical_answers']); self.assertFalse(h['rewrite_historical_mastery']); self.assertTrue(h['new_model_version_required'])

if __name__=='__main__': unittest.main()

import sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from test_generator.generator import largest_remainder,GeneratorError,generate_plan
from adaptive.selector import score_candidate,select_adaptive,AdaptiveSelectionError
from mastery.engine import compute_subtopic_mastery,aggregate_mastery,stage14_provider_payload
from datetime import datetime,timezone,timedelta
class Core(unittest.TestCase):
 def test_largest_remainder(self):self.assertEqual(sum(largest_remainder(37,{'a':1,'b':2,'c':3}).values()),37)
 def test_stage13_blocks_unpublished(self):
  cfg={'schema_version':'test-config-schema-v0.9.0','mode':'custom','question_count':1,'scope':{'combine':'AND','clauses':[{'dimension':'LESSON','ids':['L']}]},'lesson_allocation':{'strategy':'UNIFORM'},'difficulty_mix_pct':{'EASY':100,'MEDIUM':0,'HARD':0,'VERY_HARD':0},'type_allocation':{'strategy':'EXPLICIT_PCT','mix_pct':{'CLOZE_SINGLE':100}},'repetition_policy':{},'fallback_policy':{},'shuffle':{}}
  with self.assertRaises(GeneratorError):generate_plan(cfg,[{'lesson_id':'L','status':'DRAFT'}])
 def test_adaptive_weak_blocks_vh(self):
  s=score_candidate({'difficulty':'VERY_HARD','mastery_score_pct':10,'mastery_confidence':1,'tcf_weight_pct':2,'days_since_seen':30})
  self.assertFalse(s['difficulty_guardrail_pass'])
 def test_adaptive_determinism(self):
  c={'question_count':1,'diversity':{'max_lesson_share':1,'max_type_share':1},'seed':'x'};p=[{'question_revision_id':'q','status':'PUBLISHED','lesson_id':'L','question_type_code':'CLOZE_SINGLE','difficulty':'MEDIUM','tcf_weight_pct':1,'mastery_score_pct':70,'mastery_confidence':1,'days_since_seen':30}]
  self.assertEqual(select_adaptive(c,p)['selection_digest'],select_adaptive(c,p)['selection_digest'])
 def ev(self,i,ok,d='MEDIUM',mis=None):return {'answer_id':str(i),'attempt_id':'a'+str(i),'test_question_id':'q'+str(i),'answer_sequence':1,'is_correct':ok,'difficulty_code':d,'answered_at':(datetime(2026,8,8,tzinfo=timezone.utc)-timedelta(minutes=i)).isoformat(),'misconception_id':mis}
 def test_mastery_weighted(self):
  e=[self.ev(i,True,'EASY') for i in range(1,9)]+[self.ev(20+j,False,'HARD','same') for j in range(4)];r=compute_subtopic_mastery(e,datetime(2026,8,8,tzinfo=timezone.utc));self.assertLess(r['evidence_score_pct'],66.6667);self.assertEqual(stage14_provider_payload(r)['mastery_score_pct'],r['evidence_score_pct'])
 def test_coverage(self):
  p=compute_subtopic_mastery([self.ev(i,True) for i in range(1,15)],datetime(2026,8,8,tzinfo=timezone.utc));z=compute_subtopic_mastery([],datetime(2026,8,8,tzinfo=timezone.utc));self.assertEqual(aggregate_mastery([p,z,z,z])['coverage_ratio'],.25)
if __name__=='__main__':unittest.main(verbosity=2)

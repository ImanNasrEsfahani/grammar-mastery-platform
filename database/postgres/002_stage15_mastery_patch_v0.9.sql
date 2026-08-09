-- Grammar Mastery Platform — Stage 15 additive PostgreSQL patch
-- Patch version: mastery-storage-patch-v0.9.0
-- Base schema: relational-schema-v0.9.0
ALTER TABLE user_mastery
  ADD COLUMN IF NOT EXISTS evidence_score numeric(6,3), ADD COLUMN IF NOT EXISTS effective_evidence numeric(12,4),
  ADD COLUMN IF NOT EXISTS stability numeric(5,4), ADD COLUMN IF NOT EXISTS coverage_ratio numeric(5,4), ADD COLUMN IF NOT EXISTS mastery_band varchar(20);
ALTER TABLE mastery_snapshots
  ADD COLUMN IF NOT EXISTS evidence_score numeric(6,3), ADD COLUMN IF NOT EXISTS effective_evidence numeric(12,4),
  ADD COLUMN IF NOT EXISTS stability numeric(5,4), ADD COLUMN IF NOT EXISTS coverage_ratio numeric(5,4), ADD COLUMN IF NOT EXISTS mastery_band varchar(20);
DO $$ BEGIN ALTER TABLE user_mastery ADD CONSTRAINT chk_s15_um_evidence_score CHECK(evidence_score IS NULL OR evidence_score BETWEEN 0 AND 100); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE user_mastery ADD CONSTRAINT chk_s15_um_effective_evidence CHECK(effective_evidence IS NULL OR effective_evidence >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE user_mastery ADD CONSTRAINT chk_s15_um_stability CHECK(stability IS NULL OR stability BETWEEN 0 AND 1); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE user_mastery ADD CONSTRAINT chk_s15_um_coverage CHECK(coverage_ratio IS NULL OR coverage_ratio BETWEEN 0 AND 1); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE user_mastery ADD CONSTRAINT chk_s15_um_band CHECK(mastery_band IS NULL OR mastery_band IN ('NO_EVIDENCE','UNCERTAIN','WEAK','DEVELOPING','STRONG')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE mastery_snapshots ADD CONSTRAINT chk_s15_ms_evidence_score CHECK(evidence_score IS NULL OR evidence_score BETWEEN 0 AND 100); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE mastery_snapshots ADD CONSTRAINT chk_s15_ms_effective_evidence CHECK(effective_evidence IS NULL OR effective_evidence >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE mastery_snapshots ADD CONSTRAINT chk_s15_ms_stability CHECK(stability IS NULL OR stability BETWEEN 0 AND 1); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE mastery_snapshots ADD CONSTRAINT chk_s15_ms_coverage CHECK(coverage_ratio IS NULL OR coverage_ratio BETWEEN 0 AND 1); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE mastery_snapshots ADD CONSTRAINT chk_s15_ms_band CHECK(mastery_band IS NULL OR mastery_band IN ('NO_EVIDENCE','UNCERTAIN','WEAK','DEVELOPING','STRONG')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_user_mastery_band_confidence ON user_mastery(user_id, scope_type, mastery_band, confidence);
CREATE INDEX IF NOT EXISTS idx_mastery_snapshots_model_time ON mastery_snapshots(user_id, mastery_model_version, captured_at DESC);

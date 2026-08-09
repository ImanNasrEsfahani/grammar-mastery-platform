# Stage 25 — Security, privacy and data protection

This Stage 25-only overlay turns the roadmap security baseline into versioned, reviewable and executable controls. It adds the threat/control checklist, authentication design, backend RBAC matrix, endpoint-specific rate limits, privacy/retention policy, upload scanning boundary, answer-leak detector, sensitive-log redaction, security-header validator and backup-manifest restore verification.

The release state is `REFERENCE_SECURITY_CONTROLS_VALIDATED_PRODUCTION_ADAPTERS_PENDING_OWNER_ACCEPTANCE`. Local controls and negative cases are tested. The package does not claim that a production secret manager, malware scanner, HTTPS edge or production backup exists. Provider selection and a measured production-like restore drill remain Stage 26 work.

## Roadmap output mapping

| Roadmap output | Artifact |
|---|---|
| Threat checklist | `security_checklist_v1.0.md`, `threat_control_matrix_v1.0.csv` |
| Auth design | `auth_design_v1.0.md` and the security contract |
| RBAC matrix | `rbac_matrix_v1.0.csv` |
| Rate limits | `config/stage25_security_contract_v1.0.json` |
| Backup/restore plan | `backup_restore_plan_v1.0.md` and manifest verification tests |

Run `python tools/validate_stage25.py` and `python -m unittest tests.test_stage25_security -v` with `PYTHONPATH=src`. Formal owner approval, retention confirmation and production adapters remain pending Iman review.

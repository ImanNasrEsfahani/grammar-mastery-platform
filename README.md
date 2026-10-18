# Grammar Mastery

**A data-driven French grammar practice and personalized learning platform.**

[**Try the web app**](https://grammar.imannasr.com) · [**Explore the source**](https://github.com/ImanNasrEsfahani/grammar-mastery-platform) · [**Technical documentation**](docs/stages/) · [**Project status**](STATUS.md)

**Stack:** Next.js 16 · React 19 · TypeScript · Python · Django 5.2 / Django REST Framework · PostgreSQL 15 · Docker · GitHub Actions · Vitest / Python unit tests

Grammar Mastery is a full-stack educational software project focused on helping French learners practice consistently, recognize recurring mistakes, and make informed decisions about what to study next. It was conceived as a personal learning tool for structured French grammar preparation, including TCF Canada-oriented study, and developed into a modular platform with a versioned question bank, assessment workflows, learner-progress models, and supporting deployment infrastructure.

The project combines a real web application with a documented, testable learning-engine architecture. **The repository is the source of truth for implementation and reference validation; production feature availability and published question counts must be checked against the deployed environment.**

> **Project ownership:** Designed and developed by [Iman Nasr](https://github.com/ImanNasrEsfahani), a full-stack developer working across React/Next.js, Python/Django, SQL data modeling, API integration, testing, and Linux/Docker deployment.

## At a glance

| Area | What the repository contains |
| --- | --- |
| Learning content | **10,636** versioned question records spanning **52 lessons** and batches **B001–B238**, validated for the repository's canonical 46-column format |
| Practice experience | Next.js interfaces and Django/API components for lessons, tests, answers, and learner-facing study workflows |
| Personalization | Reference implementations and contracts for adaptive question selection, mastery estimation, error review, and spaced repetition |
| Progress insights | Dashboard, progress, history, and weakness-related interface and API contracts |
| Engineering | PostgreSQL schema/migrations, typed API contracts, automated tests, Docker-based runtime, and a GitHub Actions frontend-image workflow |
| Public access | [grammar.imannasr.com](https://grammar.imannasr.com) — live site reported by the project owner; this README does not independently certify every live feature |

**Important question-bank distinction:** The **10,636** figure describes the versioned **repository source inventory**, *not an independently verified count of questions currently served by the production database*. The source CSV records retain `DRAFT` status; publication follows controlled database workflows. See [the seed catalog](data/question_bank/full/v1.0/master/question_bank_seed_catalog.json) and [static validation report](data/question_bank/full/v1.0/validation/question_bank_full_B001_B238_L01_L52_validation.json).

## The learning problem

Grammar practice is often fragmented: learners answer isolated exercises but have difficulty remembering *why* an answer was wrong, which concepts repeatedly cause mistakes, or when to revisit a topic.

Grammar Mastery approaches this as both a **learning-design problem** and a **software-engineering problem**:

1. **Structured practice:** organize questions by lesson, subtopic, question type, and difficulty.
2. **Actionable feedback:** retain answer explanations and distinguish knowledge gaps from individual mistakes.
3. **Personalized progression:** use answer history and mastery-related signals to inform suggested practice and review.
4. **Repeatable quality:** apply explicit schemas, validation gates, tests, and controlled publishing to the question bank.
5. **Production-minded delivery:** keep the browser experience, API, database, testing, and operations concerns separated.

The platform is designed to support regular short practice sessions. Its adaptive, mastery, review, and spaced-repetition models have repository implementations and test coverage; **empirical calibration against real learner outcomes remains a separate operational milestone**.

## Product capabilities and engineering scope

### Practice and assessments

- Lesson- and topic-oriented practice interfaces, alongside test-creation and attempt-related routes.
- Versioned question definitions with four answer choices, one correct answer, explanations, tags, difficulty metadata, and stable identifiers.
- Question selection contracts covering custom and adaptive modes, including eligibility checks and reproducible selection rules.
- API-first communication between the Next.js frontend and Django backend.

### Personalized learning foundations

- **Adaptive selection:** question-selection logic informed by scope, difficulty and learner-related signals.
- **Mastery tracking:** data structures and reference logic for estimating progress at a lesson or subtopic level.
- **Error review:** models for collecting, classifying, and revisiting mistakes.
- **Spaced repetition:** review scheduling and revisit flows designed to reinforce retention.
- **Learning dashboard:** interfaces for progress, next actions, review queues, and learning history.

These capabilities should be read as **implemented interfaces, domain components, and/or reference-tested workflows**, not a blanket claim that every endpoint and user journey is fully wired to the current public production deployment. The deployment-specific truth is recorded in the relevant runtime and release evidence.

### Question-bank quality and governance

The repository's canonical bank includes **10,636 question records across 52 lesson-specific CSV files**, organized through **238 batches**. The [validation report](data/question_bank/full/v1.0/validation/question_bank_full_B001_B238_L01_L52_validation.json) records successful static consolidation checks, including:

- the expected **46-column schema**;
- unique external question IDs;
- exactly four distinct options and one correct answer key per question;
- populated explanations and controlled metadata;
- no duplicate normalized question stems in the validated inventory;
- clear distinction between draft authoring data and database publication status.

This is **static validation evidence**, not proof that all questions have undergone independent editorial review or are currently published online. Controlled review and versioned content publishing remain essential parts of the design.

## Architecture

```text
Browser / Learner
      │
      ▼
Next.js 16 + React 19 + TypeScript
  - App Router, lesson/test/dashboard interfaces
  - same-origin browser-facing requests
  - typed API client and test tooling
      │
      ▼
Django 5.2 + Django REST Framework
  - REST API contracts and runtime adapters
  - question selection and learning-domain logic
  - account, attempt, progress and review models
      │
      ▼
PostgreSQL 15
  - relational question bank and lesson taxonomy
  - answers, attempts, mastery and review history

Supporting infrastructure:
  Docker Compose · Linux deployment · GitHub Actions image build
  Python unittest · Vitest · ESLint · TypeScript type checking
```

### Design decisions

| Decision | Rationale |
| --- | --- |
| **Next.js + TypeScript** | Maintainable frontend components, typed integration, server-side routing boundaries and a testable UI |
| **Django + DRF** | Separation of HTTP contracts from learning-domain logic, backed by Python validation and tests |
| **PostgreSQL** | Relational integrity for lessons, questions, attempts, answers, and progress history |
| **Versioned content schemas** | Deterministic import/validation, reproducibility, and safer question revisions |
| **Adaptive/review modules as separate components** | Keep selection, mastery, error review, and scheduling independently testable |
| **Docker and repeatable checks** | Consistent runtime configuration and a clearer deployment/maintenance workflow |

API contracts are documented in [`api/stage21_core_api_spec_v1.0.yaml`](api/stage21_core_api_spec_v1.0.yaml). Frontend API types are generated from that specification; they should not be hand-edited.

## Repository guide

```text
frontend/       Next.js / React / TypeScript application
src/            Python learning engines and backend components
api/            OpenAPI specifications and API contracts
database/       PostgreSQL schema and migrations
data/           Lesson taxonomy, versioned question bank, seed catalog
ops/            Bootstrap, release and migration tooling
docs/           Stage-by-stage technical design, governance and runbooks
tests/          Python tests and reference fixtures
validation/     Validation tooling and evidence
.github/        GitHub Actions workflows
```

Useful starting points:

- [Frontend development notes](frontend/README.md)
- [Question-bank catalog](data/question_bank/full/v1.0/master/question_bank_seed_catalog.json)
- [Question-bank validation](data/question_bank/full/v1.0/validation/question_bank_full_B001_B238_L01_L52_validation.json)
- [Backend API contract](api/stage21_core_api_spec_v1.0.yaml)
- [Docker/Linux deployment guide](docs/deployment/DOCKER_LINUX_SERVER.md)
- [Stage 26 operations and release gates](docs/stages/stage26/README.md)
- [Stage 27 calibration framework](docs/stages/stage27/README.md)
- [Detailed stage and acceptance status](STATUS.md)

## Run and validate locally

> **Prerequisites:** Docker with Compose; for frontend-only development, Node.js **24+** and npm. Database initialization, seed publication, runtime API availability, and production configuration are separate concerns; starting containers alone does not prove the complete learning journey works.

### Option A — Start the containerized development/staging stack

```bash
# From the repository root
cp docker.env.example .env.docker
# Edit .env.docker: replace all CHANGE_ME values and review host/security settings.

docker compose --env-file .env.docker config
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps

# Process-health checks (do not establish data readiness on their own)
curl -fsS http://127.0.0.1:8000/health/live
curl -fsS http://127.0.0.1:8000/health/ready
```

The Docker setup uses an internal PostgreSQL service and defaults to loopback-only frontend/backend bindings. **It does not automatically run database migrations.** For an existing server, do not initialize or replace a database without a verified backup, staging rehearsal and the documented release steps: [Deployment guide](docs/deployment/DOCKER_LINUX_SERVER.md) and [Fresh-database bootstrap guide](README_FRESH_DATABASE_WITH_PUBLISHED_QUESTIONS.md).

### Option B — Work on the frontend locally

```bash
cd frontend
cp .env.example .env.local
npm ci
npm run api:generate
npm run dev
```

Set the **server-only** `DJANGO_API_BASE_URL` to a reachable backend origin. Do not expose access tokens or Django secrets via `NEXT_PUBLIC_` environment variables.

### Tests and static checks

```bash
# Frontend
cd frontend
npm run validate    # API generation, lint, type-check, tests, production build

# Backend/domain reference suite: run from repository root
cd ..
python -m pip install -r requirements-dev.txt
PYTHONPATH=src python -m unittest discover -s tests -p 'test_*.py'
```

Some tests require a real PostgreSQL service or deployment-specific configuration and may be skipped or blocked without those dependencies. Passing local/reference tests is not equivalent to a production end-to-end certification. See [stage-specific reports](docs/stages/) for the scope of each validation gate.

## Project status and evidence boundaries

**The application is presented by its owner as publicly deployed** at [grammar.imannasr.com](https://grammar.imannasr.com). The public repository also records completed source-content work and substantial reference implementations, but several operational records were written before later question-bank extensions and are not always synchronized.

| Topic | Verified repository evidence | What is *not* automatically established |
| --- | --- | --- |
| Question bank | **10,636** source rows; **52** lesson CSVs; **B001–B238**; passing static validation | 10,636 `PUBLISHED` rows or 10,636 currently served questions in the live database |
| Frontend | Next.js routes, UI components, TypeScript tooling and tests | Every route verified against the currently deployed backend |
| Backend | Django/DRF configuration, REST contracts, learning modules and runtime adapters | All API endpoints operational in every deployment |
| Testing | Unit/contract/reference test artifacts and a frontend validation script | A universally passing live end-to-end suite or measured production SLA |
| Personalization | Adaptive, mastery, review and SRS reference logic | Empirically optimized learning outcomes or live model calibration |
| Release | Docker and deployment runbooks; image-building GitHub Actions workflow | Production-specific backup, monitoring, recovery, and approval evidence |

**Documentation reconciliation:** Earlier root-level status/runbook snapshots describe a **3,640-row seed**, and an earlier bootstrap example references **8,175 rows**. The [current canonical seed catalog](data/question_bank/full/v1.0/master/question_bank_seed_catalog.json) and [full-plan validation](data/question_bank/full/v1.0/validation/question_bank_full_B001_B238_L01_L52_validation.json) define **10,636 source rows** as the newer repository baseline. These figures refer to different content snapshots; they should not be interpreted as interchangeable production counts.

The Stage 23 standard Import/Preview/Commit path carries a recorded manifest-drift blocker in the seed catalog. The canonical seed/bootstrap path is separate. Stage 27's empirical calibration also requires genuine live usage data and explicit operational verification: see [Stage 27](docs/stages/stage27/README.md). This README intentionally does not claim those pending gates have passed.

## Next engineering priorities

- Reconcile historical status documents with the latest 10,636-row source inventory and actual deployed PostgreSQL counts.
- Verify key learner journeys against the deployed API and database, and record reproducible smoke/E2E evidence.
- Resolve remaining import-pipeline and production release-evidence gates without bypassing content review.
- Use real, privacy-conscious learner telemetry to evaluate and calibrate adaptive selection, review timing and question quality.
- Keep the live site's feature matrix and this README synchronized with tested releases.

## Maintainer and scope

**Iman Nasr** — [GitHub](https://github.com/ImanNasrEsfahani) · [LinkedIn](https://www.linkedin.com/in/iman-nasr-esfahani)

Grammar Mastery is an independent educational software project; it is **not an official TCF Canada examination service or affiliated certification provider**. Educational questions and study recommendations do not guarantee any examination result.

This repository does not currently publish a root `LICENSE` file. Please contact the maintainer before reusing the source or learning content beyond the permissions expressly available under applicable law.

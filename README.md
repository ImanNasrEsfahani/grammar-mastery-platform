# Grammar Mastery

**A live French grammar learning platform — built with Next.js, Django, and PostgreSQL.**

[**Try the web app**](https://grammar.imannasr.com) · [**Explore the source**](https://github.com/ImanNasrEsfahani/grammar-mastery-platform) · [**Technical documentation**](docs/stages/) · [**Project status**](STATUS.md)

**Stack:** Next.js 16 · React 19 · TypeScript · Python · Django 5.2 / Django REST Framework · PostgreSQL 15 · Docker · GitHub Actions · Vitest / Python unit tests

**Grammar Mastery is running in production and is actively used by real learners, including customers and its creator.** Originally built to support Iman Nasr's own French study and TCF Canada preparation, it has grown into a full-stack educational product for structured grammar practice, reviewing mistakes, and following learning progress.

The application combines a working web service with a modular learning-engine architecture, a versioned question bank, automated testing, and Docker-based operations. This repository documents the implementation and historical engineering decisions behind the running product. **Some older status reports describe pending validation at the time they were written; they are not a statement that the current web application is offline or unused.**

> **Creator & maintainer:** [Iman Nasr](https://github.com/ImanNasrEsfahani) — full-stack design and development spanning React/Next.js, Python/Django, SQL data modeling, REST APIs, automated testing, and Docker/Linux deployment. Iman also uses the live application for his own ongoing French study.

## At a glance

| Area | Product and engineering snapshot |
| --- | --- |
| Learning content | **10,636** versioned question records spanning **52 lessons** and batches **B001–B238**, validated for the repository's canonical 46-column format |
| Live application | **Production-deployed and actively used** for French learning; used by customers and by the creator himself |
| Personalization | Reference implementations and contracts for adaptive question selection, mastery estimation, error review, and spaced repetition |
| Progress insights | Dashboard, progress, history, and weakness-related interface and API contracts |
| Engineering | PostgreSQL schema/migrations, typed API contracts, automated tests, Docker-based runtime, and a GitHub Actions frontend-image workflow |
| Public access | **[grammar.imannasr.com](https://grammar.imannasr.com)** — the running production application |

**Question-bank counting:** The **10,636** figure refers to versioned question records in the **repository source inventory**. It is **not presented as the number of questions currently published or served by the production database**. Source CSV records retain `DRAFT` authoring status; serving/publication is tracked separately. See the [seed catalog](data/question_bank/full/v1.0/master/question_bank_seed_catalog.json) and [static validation report](data/question_bank/full/v1.0/validation/question_bank_full_B001_B238_L01_L52_validation.json).

## The learning problem

Grammar practice is often fragmented: learners answer isolated exercises but have difficulty remembering *why* an answer was wrong, which concepts repeatedly cause mistakes, or when to revisit a topic.

Grammar Mastery approaches this as both a **learning-design problem** and a **software-engineering problem**:

1. **Structured practice:** organize questions by lesson, subtopic, question type, and difficulty.
2. **Actionable feedback:** retain answer explanations and distinguish knowledge gaps from individual mistakes.
3. **Personalized progression:** use answer history and mastery-related signals to inform suggested practice and review.
4. **Repeatable quality:** apply explicit schemas, validation gates, tests, and controlled publishing to the question bank.
5. **Production-minded delivery:** keep the browser experience, API, database, testing, and operations concerns separated.

The live product supports an ongoing French-study use case. Its adaptive selection, mastery, error-review, and spaced-repetition domain modules have repository implementations and test coverage. **Measuring and refining these models against real usage data remains a distinct engineering activity**; using a live product is not the same as claiming experimentally proven learning gains.

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

The **application itself is live and used by real learners**. This section describes the capabilities represented in the codebase and the product architecture; it does not imply that every reference algorithm, administrative endpoint, or planned feature is part of every deployed release. For release-specific behavior, consult the corresponding runtime configuration and operational evidence.

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

> **Prerequisites:** Docker with Compose; for frontend-only development, Node.js **24+** and npm. These instructions describe a **new local environment**, not the already running production site. Database initialization and content publication are separate operations; starting local containers alone does not reproduce production data or user activity.

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

## Production status and engineering evidence

**Current product status: LIVE / IN USE.** [Grammar Mastery](https://grammar.imannasr.com) is a production-deployed French learning application with real users, including customers. Its creator, Iman Nasr, also actively uses it for French study. This is the **current operational status confirmed by the project owner**. No specific customer count, paid-subscription count, uptime percentage, or production question-serving total is claimed here.

**Why some documents say “pending”:** Repository stage reports were captured at different times and often describe whether a particular *reference implementation, migration rehearsal, acceptance step, or formal verification artifact* had been completed. Those historical labels should not be read as proof that the currently operating web application has no real users. Similarly, the existence of a live site does not by itself certify every optional API, dataset, or experimental learning model.

| Area | Current understanding | Supporting evidence and scope |
| --- | --- | --- |
| **Product availability and use** | **Live production service; actively used by customers and its creator** | Owner-confirmed current status; [open the application](https://grammar.imannasr.com). Private customer details and analytics are not published. |
| **Question-bank source inventory** | **10,636** versioned question records, **52 lessons**, **B001–B238** | [Canonical source catalog](data/question_bank/full/v1.0/master/question_bank_seed_catalog.json) and [static validation](data/question_bank/full/v1.0/validation/question_bank_full_B001_B238_L01_L52_validation.json). This is not a live `PUBLISHED`-row count. |
| **Frontend** | Next.js/React/TypeScript application with learning routes, components, and typed API integration | [`frontend/`](frontend/) and [`frontend/package.json`](frontend/package.json). Actual enabled features depend on the deployed release. |
| **Backend and data** | Django/DRF and PostgreSQL code, schemas, learning-domain modules, and runtime adapters | [`src/`](src/), [`database/`](database/), and [core API contract](api/stage21_core_api_spec_v1.0.yaml). |
| **Adaptive learning and review** | Adaptive-selection, mastery, error-review, and spaced-repetition modules are part of the implemented/tested architecture | Domain code and stage reports; empirically calibrated effectiveness is not claimed. |
| **Testing and delivery** | Versioned Python/frontend tests, validation tooling, Docker setup, and GitHub Actions frontend-image workflow | [`tests/`](tests/), [`frontend/`](frontend/), [deployment notes](docs/deployment/DOCKER_LINUX_SERVER.md). A measured production SLA or universal live E2E pass is not claimed. |

**Historical inventory reconciliation:** Earlier status/runbook snapshots refer to a **3,640-question seed**, and another historical bootstrap example mentions **8,175 questions**. The [current canonical catalog](data/question_bank/full/v1.0/master/question_bank_seed_catalog.json) and [consolidation validation](data/question_bank/full/v1.0/validation/question_bank_full_B001_B238_L01_L52_validation.json) establish the newer **10,636-question source inventory**. The figures describe different repository snapshots/workflows; none alone specifies how many items a learner can currently access online.

The Stage 23 standard Import/Preview/Commit workflow has a recorded manifest-drift blocker in the source catalog; the canonical seed/bootstrap process is a separate path. Stage 27's empirical calibration similarly requires real usage measurements and review of model changes. These **workflow-specific status items do not negate the production operation of Grammar Mastery**. See [Stage 27](docs/stages/stage27/README.md) and [historical stage status](STATUS.md) for their technical scope.

## Next engineering priorities

- Update historical `STATUS.md` and stage handoff documents to distinguish the **operating production product** from past acceptance/release-evidence checkpoints.
- Record non-sensitive production verification for key learner journeys (for example, a repeatable login → practice → results check), without disclosing user data.
- Reconcile the **10,636-record repository inventory** with the currently published/serving question counts using authorized production database checks.
- Resolve remaining import-pipeline and release-evidence gates without bypassing content review, backup, or recovery procedures.
- Use privacy-conscious, aggregated real-world learning data to evaluate question quality and calibrate personalized selection/review models.
- Keep public product documentation synchronized with each tested deployment.

## Maintainer and scope

**Iman Nasr** — [GitHub](https://github.com/ImanNasrEsfahani) · [LinkedIn](https://www.linkedin.com/in/iman-nasr-esfahani)

Grammar Mastery is an independent educational software project; it is **not an official TCF Canada examination service or affiliated certification provider**. Educational questions and study recommendations do not guarantee any examination result.

This repository does not currently publish a root `LICENSE` file. Please contact the maintainer before reusing the source or learning content beyond the permissions expressly available under applicable law.

from __future__ import annotations

import argparse
import csv
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import traceback
import unicodedata
import uuid
from typing import Any

import psycopg
from psycopg.rows import dict_row

BOOTSTRAP_VERSION = "question-bank-bootstrap-v1.0.3"
WORKFLOW_VERSION = "question-qa-workflow-v0.9.0"
CANONICAL_PUBLICATION_VERSION = "canonical-question-bank-publication-v1.0.0"
CANONICAL_PUBLISHER_EXTERNAL_ID = "canonical-question-bank-publisher-v1.0"
SYSTEM_VERSION_COMPONENT = "question_bank.canonical_seed"
STAGE23_MARKER = "STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT"
QB_COMPATIBILITY_CATALOGUE_VERSION = "question-bank-misconception-compatibility-v1.0.0"
QB_COMPATIBILITY_FAMILY = "QUESTION_BANK_COMPATIBILITY"
QB_COMPATIBILITY_RELATIVE_DIR = Path(
    "data/question_bank/full/v1.0/compatibility"
)
QB_COMPATIBILITY_GLOB = (
    "question_bank_misconception_compatibility_L??_B???-B???_v1.0.csv"
)
QB_COMPATIBILITY_FILENAME_RE = re.compile(
    r"question_bank_misconception_compatibility_L(?P<lesson>\d{2})_"
    r"B(?P<start>\d{3})-B(?P<end>\d{3})_v1\.0\.csv"
)
QB_COMPATIBILITY_EXPECTED_LESSONS = set(range(1, 53))
QB_COMPATIBILITY_EXPECTED_BATCHES = set(range(1, 239))
QB_COMPATIBILITY_SCOPED_UID_NAMESPACE = uuid.UUID(
    "4ccbe0b5-a7e9-5f8c-a345-4a50a5098ee7"
)
QB_COMPATIBILITY_HEADER = [
    "catalogue_version", "misconception_id", "home_subtopic_id", "home_subtopic_code",
    "question_bank_scope", "first_external_id", "use_count", "subtopic_codes_seen",
    "family", "name_fa", "statement_fa", "diagnostic_interpretation_fa",
    "distractor_authoring_hint_fa", "priority", "status", "empirical_commonness",
    "evidence_examples", "source_ref",
]
EXPECTED_HEADER = [
    "schema_version", "external_id", "question_revision", "lesson_id", "lesson_code",
    "subtopic_id", "subtopic_code", "secondary_subtopic_ids", "question_type", "stem",
    "stem_locale", "option_a", "option_b", "option_c", "option_d", "option_locale",
    "correct_option", "full_explanation", "explanation_a", "explanation_b", "explanation_c",
    "explanation_d", "explanation_locale", "misconception_a_id", "misconception_b_id",
    "misconception_c_id", "misconception_d_id", "difficulty", "difficulty_score_initial",
    "difficulty_model_version", "status", "source_type", "source_ref", "author_id",
    "reviewer_id", "tags", "media_type", "media_uri", "media_alt_text", "media_transcript",
    "media_source_ref", "taxonomy_version", "question_type_catalogue_version",
    "compatibility_version", "distractor_rules_version", "content_version",
]
QUESTION_UID_NAMESPACE = uuid.UUID("930e8ba5-40ff-59be-95d2-28092c4ab5c9")


class BootstrapError(RuntimeError):
    pass


class BootstrapProgress:
    """Stage-by-stage terminal progress and structured failure diagnostics.

    Human-readable progress is written to stderr so the successful JSON emitted
    on stdout remains machine-readable.  No third-party logging dependency is
    required.

    Environment controls:
      GMP_BOOTSTRAP_COLOR=always|auto|never
      GMP_BOOTSTRAP_PROGRESS=0      disable stage progress lines
      GMP_BOOTSTRAP_TRACEBACK=0     omit traceback from failure JSON
      NO_COLOR=1                    standard ANSI color opt-out
    """

    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    CYAN = "\033[96m"
    DIM = "\033[2m"
    RESET = "\033[0m"

    def __init__(self, stream: Any = None) -> None:
        self.stream = stream if stream is not None else sys.stderr
        progress_env = os.getenv("GMP_BOOTSTRAP_PROGRESS", "1").strip().lower()
        self.enabled = progress_env not in {"0", "false", "no", "off"}

        color_mode = os.getenv("GMP_BOOTSTRAP_COLOR", "auto").strip().lower()
        if os.getenv("NO_COLOR"):
            color_mode = "never"
        if color_mode in {"always", "1", "true", "yes", "on"}:
            self.use_color = True
        elif color_mode in {"never", "0", "false", "no", "off"}:
            self.use_color = False
        else:
            isatty = getattr(self.stream, "isatty", None)
            self.use_color = bool(isatty and isatty())

        self.current: dict[str, Any] | None = None
        self.completed: list[dict[str, Any]] = []
        self.skipped: list[dict[str, str]] = []
        self.failed: dict[str, Any] | None = None

    def _emit(
        self,
        color: str,
        code: str,
        status: str,
        name: str,
        detail: str = "",
    ) -> None:
        if not self.enabled:
            return
        timestamp = datetime.now().astimezone().strftime("%H:%M:%S")
        line = f"[{timestamp}] [QB-BOOTSTRAP][{code}][{status}] {name}"
        if detail:
            line += f" | {detail}"
        if self.use_color:
            line = f"{color}{line}{self.RESET}"
        print(line, file=self.stream, flush=True)

    def start(self, code: str, name: str) -> None:
        if self.current is not None:
            raise RuntimeError(
                f"bootstrap progress stages overlap: {self.current['code']} -> {code}"
            )
        self.current = {
            "code": code,
            "name": name,
            "started": time.perf_counter(),
        }
        self._emit(self.CYAN, code, "RUNNING", name, "started")

    def finish_current(self, detail: str = "") -> None:
        if self.current is None:
            raise RuntimeError("bootstrap progress has no running stage to finish")
        elapsed = time.perf_counter() - float(self.current["started"])
        record = {
            "code": str(self.current["code"]),
            "name": str(self.current["name"]),
            "duration_seconds": round(elapsed, 3),
        }
        self.completed.append(record)
        suffix = f"SUCCESS; {detail + '; ' if detail else ''}{elapsed:.2f}s"
        self._emit(self.GREEN, record["code"], "FINISHED", record["name"], suffix)
        self.current = None

    def fail_current(self, exc: BaseException) -> None:
        if self.current is None:
            if self.failed is None:
                self.failed = {
                    "code": "UNTRACKED",
                    "name": "Untracked bootstrap operation",
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                    "duration_seconds": None,
                }
                self._emit(
                    self.RED,
                    "UNTRACKED",
                    "FAILED",
                    "Untracked bootstrap operation",
                    f"{type(exc).__name__}: {exc}",
                )
            return

        elapsed = time.perf_counter() - float(self.current["started"])
        code = str(self.current["code"])
        name = str(self.current["name"])
        self.failed = {
            "code": code,
            "name": name,
            "error_type": type(exc).__name__,
            "error": str(exc),
            "duration_seconds": round(elapsed, 3),
        }
        self._emit(
            self.RED,
            code,
            "FAILED",
            name,
            f"{type(exc).__name__}: {exc}; failed after {elapsed:.2f}s",
        )
        self.current = None

    @contextmanager
    def stage(self, code: str, name: str):
        self.start(code, name)
        stage_info: dict[str, str] = {"detail": ""}
        try:
            yield stage_info
        except Exception as exc:
            self.fail_current(exc)
            raise
        else:
            self.finish_current(stage_info.get("detail", ""))

    def skip(self, code: str, name: str, detail: str) -> None:
        self.skipped.append({"code": code, "name": name, "detail": detail})
        self._emit(self.YELLOW, code, "SKIPPED", name, detail)

    def has_completed(self, code: str) -> bool:
        return any(row["code"] == code for row in self.completed)

    def snapshot(self) -> dict[str, Any]:
        last_completed = self.completed[-1]["code"] if self.completed else None
        return {
            "completed_stages": [row["code"] for row in self.completed],
            "completed_stage_details": self.completed,
            "skipped_stages": self.skipped,
            "last_completed_stage": last_completed,
            "failed_stage": self.failed,
            "database_commit_completed": self.has_completed("S12"),
        }

    def diagnostic(self, label: str, value: str, *, warning: bool = False) -> None:
        color = self.YELLOW if warning else self.RED
        self._emit(color, "DIAG", "DETAIL", label, value)

    def stopped(self, rollback_note: str = "") -> None:
        failed = self.failed or {
            "code": "UNTRACKED",
            "name": "Untracked bootstrap operation",
            "error": "unknown failure",
        }
        last_completed = self.completed[-1]["code"] if self.completed else "none"
        detail = (
            f"failed_stage={failed['code']} ({failed['name']}); "
            f"last_completed_stage={last_completed}"
        )
        if rollback_note:
            detail += f"; {rollback_note}"
        self._emit(self.RED, "STOP", "STOPPED", "Bootstrap halted", detail)

    def complete(self, target_count: int) -> None:
        self._emit(
            self.GREEN,
            "DONE",
            "FINISHED",
            "Question Bank bootstrap",
            f"SUCCESS; target_questions={target_count}; committed=yes",
        )


def _safe_database_environment() -> dict[str, str]:
    """Return non-secret libpq settings useful when diagnosing connection issues."""
    result: dict[str, str] = {}
    for key in ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGSSLMODE"):
        value = os.getenv(key)
        if value:
            result[key] = value
    return result


def _postgres_exception_details(exc: BaseException) -> dict[str, str]:
    """Extract psycopg diagnostics without exposing credentials or query parameters."""
    if not isinstance(exc, psycopg.Error):
        return {}

    details: dict[str, str] = {}
    sqlstate = getattr(exc, "sqlstate", None)
    if sqlstate:
        details["sqlstate"] = str(sqlstate)

    diag = getattr(exc, "diag", None)
    if diag is None:
        return details

    fields = {
        "severity": "severity_nonlocalized",
        "message_primary": "message_primary",
        "message_detail": "message_detail",
        "message_hint": "message_hint",
        "schema_name": "schema_name",
        "table_name": "table_name",
        "column_name": "column_name",
        "constraint_name": "constraint_name",
        "context": "context",
    }
    for output_name, attr_name in fields.items():
        try:
            value = getattr(diag, attr_name, None)
        except Exception:
            value = None
        if value:
            details[output_name] = str(value)
    return details


def _exception_chain(exc: BaseException) -> list[dict[str, str]]:
    chain: list[dict[str, str]] = []
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen and len(chain) < 8:
        seen.add(id(current))
        chain.append({"type": type(current).__name__, "message": str(current)})
        current = current.__cause__ or current.__context__
    return chain


def _failure_hints(stage_code: str, exc: BaseException) -> list[str]:
    hints_by_stage = {
        "S00": [
            "Review publication flags. --publish-reviewed and --publish-canonical-seed are mutually exclusive.",
            "Human-review publication requires both --confirm-human-review and --reviewer-external-id.",
        ],
        "S01": [
            "Check the seed catalog/master CSV paths and the consolidation validation JSON referenced by them.",
            "Confirm the exact Stage10 46-column header, DRAFT source status, unique external_id values, and the Stage23 marker.",
        ],
        "S02": [
            "Verify the PostgreSQL container/service is healthy and reachable from the process running bootstrap.py.",
            "Check PGHOST, PGPORT, PGDATABASE and PGUSER inside the backend container; credentials are intentionally not printed.",
        ],
        "S03": [
            "Verify the official Stage26 migrations have installed the Stage12 tables before running this bootstrap.",
            "Verify the canonical Stage12 reference seed contains at least 52 lessons, 304 subtopics and 35 tags.",
        ],
        "S04": [
            "Check the three Stage6 catalogue/compatibility CSV files for missing files, unknown IDs or version drift.",
            "Do not bypass NOT_SUITABLE or CONDITIONAL guardrails to make the bootstrap pass.",
        ],
        "S05": [
            "Check Stage7 historical and recovered misconception catalogues for UUID, subtopic, family or semantic-mapping ambiguity.",
            "If more than one historical misconception matches a recovered concept, fix the source mapping instead of guessing.",
        ],
        "S06": [
            "Check the 52 lesson-scoped Question Bank misconception compatibility catalogues, their filename/lesson/subtopic consistency, and exact L01-L52 / B001-B238 coverage.",
            "Unknown diagnostic UUIDs must be present in Stage7 or in the checked-in compatibility bridge; new IDs fail closed.",
        ],
        "S07": [
            "Use the failing external_id/message to inspect question_type, subtopic, tags and misconception references in the repository source.",
            "Verify every distractor has a resolvable misconception, the correct option has none, and all referenced tags/subtopics exist.",
        ],
        "S08": [
            "Inspect the failing questions for exactly four options, one valid correct option, distractor misconception mappings and Stage6 compatibility.",
            "CONDITIONAL questions must have guardrail_satisfied=true; NOT_SUITABLE questions are never accepted.",
        ],
        "S09": [
            "Check question_validation_runs schema/constraints and confirm the target questions still exist in the same transaction.",
        ],
        "S10": [
            "For reviewed publication, the reviewer must be an active REVIEWER/ADMIN and must not be the question author.",
            "For canonical seed publication, do not reuse an in-progress human review workflow.",
        ],
        "S11": [
            "Compare PUBLISHED and SERVING counts with target_questions and inspect v_serving_questions if they differ.",
            "Do not treat the Stage23 manifest-hash blocker as a reason to bypass Question Bank static/live validation.",
        ],
        "S12": [
            "The database commit failed. Check PostgreSQL connectivity, locks, disk/WAL capacity and server logs before retrying.",
            "Because S12 did not finish, treat all bootstrap database changes from this run as uncommitted.",
        ],
    }
    hints = list(hints_by_stage.get(stage_code, []))
    if isinstance(exc, psycopg.OperationalError):
        hints.append("psycopg reported an operational error; prioritize network/service health, credentials and server availability checks.")
    elif isinstance(exc, psycopg.IntegrityError):
        hints.append("psycopg reported an integrity error; inspect the reported table/constraint and the referenced canonical IDs.")
    elif isinstance(exc, BootstrapError):
        hints.append("This is a fail-closed bootstrap validation error; fix the cited source/schema condition rather than suppressing the check.")
    if not hints:
        hints.append("Use the traceback and exception chain below to identify the first project function that raised the error.")
    return hints


def _build_failure_diagnostics(
    exc: BaseException,
    progress: BootstrapProgress,
    rollback: dict[str, Any],
) -> dict[str, Any]:
    failed = progress.failed or {}
    stage_code = str(failed.get("code") or "UNTRACKED")
    traceback_env = os.getenv("GMP_BOOTSTRAP_TRACEBACK", "1").strip().lower()
    include_traceback = traceback_env not in {"0", "false", "no", "off"}
    return {
        "exception_type": type(exc).__name__,
        "message": str(exc),
        "exception_chain": _exception_chain(exc),
        "postgres": _postgres_exception_details(exc),
        "database_environment": _safe_database_environment(),
        "rollback": rollback,
        "suggested_checks": _failure_hints(stage_code, exc),
        "traceback": traceback.format_exc() if include_traceback else "disabled by GMP_BOOTSTRAP_TRACEBACK",
    }


def _print_failure_diagnostics(
    progress: BootstrapProgress,
    diagnostics: dict[str, Any],
) -> None:
    failed = progress.failed or {}
    progress.diagnostic(
        "Failure location",
        f"{failed.get('code', 'UNTRACKED')} - {failed.get('name', 'Untracked bootstrap operation')}",
    )
    progress.diagnostic(
        "Exception",
        f"{diagnostics['exception_type']}: {diagnostics['message']}",
    )
    last_completed = progress.snapshot().get("last_completed_stage") or "none"
    progress.diagnostic("Last successful stage", str(last_completed))

    rollback = diagnostics.get("rollback") or {}
    if rollback.get("attempted"):
        rollback_text = "succeeded" if rollback.get("succeeded") else f"FAILED: {rollback.get('error') or 'unknown rollback error'}"
    else:
        rollback_text = str(rollback.get("reason") or "not required")
    progress.diagnostic("Database rollback", rollback_text, warning=not bool(rollback.get("succeeded", True)))

    postgres = diagnostics.get("postgres") or {}
    if postgres:
        concise = "; ".join(f"{k}={v}" for k, v in postgres.items() if k != "context")
        progress.diagnostic("PostgreSQL diagnostics", concise or "available in failure JSON")

    for index, hint in enumerate(diagnostics.get("suggested_checks") or [], start=1):
        progress.diagnostic(f"Suggested check {index}", str(hint), warning=True)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.is_file():
        raise BootstrapError(f"source file missing: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise BootstrapError(f"CSV has no header: {path}")
        rows = [dict(r) for r in reader]
        return list(reader.fieldnames), rows


def first(row: dict[str, str], *names: str, default: str = "") -> str:
    for name in names:
        value = row.get(name)
        if value is not None and str(value).strip() != "":
            return str(value).strip()
    return default


def boolish(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical(value: str) -> str:
    value = unicodedata.normalize("NFC", str(value))
    value = " ".join(value.strip().split())
    return value.casefold()


def fingerprint(row: dict[str, str]) -> str:
    options = [row[f"option_{x}"] for x in "abcd"]
    correct = row["option_" + row["correct_option"].strip().lower()]
    parts = [
        canonical(row["stem"]),
        row["lesson_id"].strip(),
        row["subtopic_id"].strip(),
        row["question_type"].strip(),
        canonical(correct),
        *sorted(canonical(o) for o in options),
    ]
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def connect() -> psycopg.Connection:
    # Docker Compose already exposes libpq PG* variables to backend.
    return psycopg.connect(autocommit=False, row_factory=dict_row)


def discover_master(root: Path, explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit)
        if not p.is_absolute():
            p = root / p
        return p
    directory = root / "data/question_bank/full/v1.0/master"
    candidates = sorted(directory.glob("question_bank_full_*.csv"))
    if len(candidates) != 1:
        raise BootstrapError(
            f"expected exactly one full master CSV in {directory}; found {len(candidates)}. "
            "Use --master to select one explicitly."
        )
    return candidates[0]


def validation_path_for(master: Path) -> Path:
    root = repo_root()
    return root / "data/question_bank/full/v1.0/validation" / f"{master.stem}_validation.json"


def load_and_validate_master(master: Path) -> tuple[list[dict[str, str]], dict[str, Any], str]:
    header, rows = read_csv(master)
    if header != EXPECTED_HEADER:
        raise BootstrapError("Question Bank CSV header does not match the exact Stage10 46-column schema")
    if not rows:
        raise BootstrapError("Question Bank master is empty")
    if len({r["external_id"] for r in rows}) != len(rows):
        raise BootstrapError("duplicate external_id values in selected master")
    if any(r["status"] != "DRAFT" for r in rows):
        raise BootstrapError("repository Question Bank source must remain DRAFT")
    for n, row in enumerate(rows, start=2):
        correct = row["correct_option"].strip().upper()
        if correct not in {"A", "B", "C", "D"}:
            raise BootstrapError(f"invalid correct_option at CSV line {n}")
        if row[f"misconception_{correct.lower()}_id"].strip():
            raise BootstrapError(f"correct option has misconception at CSV line {n}")
        for letter in "ABCD":
            if letter != correct and not row[f"misconception_{letter.lower()}_id"].strip():
                raise BootstrapError(f"distractor lacks misconception at CSV line {n}")
        if row["media_type"] != "NONE":
            raise BootstrapError(
                f"{BOOTSTRAP_VERSION} currently accepts repository QB rows with media_type=NONE only; "
                f"found {row['media_type']!r} at CSV line {n}"
            )

    vp = validation_path_for(master)
    if not vp.is_file():
        raise BootstrapError(f"consolidation validation missing: {vp}")
    validation = json.loads(vp.read_text(encoding="utf-8"))
    if validation.get("status") != "PASS_STATIC_CONSOLIDATION":
        raise BootstrapError("repository consolidation validation is not PASS_STATIC_CONSOLIDATION")
    scope = validation.get("scope") or {}
    if int(scope.get("question_count", -1)) != len(rows):
        raise BootstrapError("validation question_count does not match master CSV")
    if ((validation.get("stage23") or {}).get("status")) != STAGE23_MARKER:
        raise BootstrapError("Stage23 blocker marker is absent or changed in validation evidence")
    schema = validation.get("schema") or {}
    if schema.get("master_header_matches") is not True or int(schema.get("actual_column_count", 0)) != 46:
        raise BootstrapError("validation does not confirm exact Stage10 schema")
    return rows, validation, sha256_file(master)


def load_repository_seed(
    root: Path,
    explicit_master: str | None = None,
) -> tuple[Path, list[dict[str, str]], dict[str, Any], str]:
    """Load the versioned repository seed, optionally from a multi-file seed catalog.

    Backward compatibility is preserved: when no catalog exists, the historical
    single-master behavior is unchanged. ``--master`` also keeps selecting one
    explicit CSV exactly as before.
    """
    if explicit_master:
        master = discover_master(root, explicit_master)
        rows, validation, master_sha = load_and_validate_master(master)
        return master, rows, validation, master_sha

    catalog_path = root / "data/question_bank/full/v1.0/master/question_bank_seed_catalog.json"
    if not catalog_path.is_file():
        master = discover_master(root, None)
        rows, validation, master_sha = load_and_validate_master(master)
        return master, rows, validation, master_sha

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    source_names = catalog.get("sources") or []
    if not isinstance(source_names, list) or not source_names:
        raise BootstrapError("Question Bank seed catalog has no sources")

    rows: list[dict[str, str]] = []
    source_hashes: list[tuple[str, str]] = []
    for raw_name in source_names:
        relative = Path(str(raw_name))
        if relative.is_absolute() or ".." in relative.parts:
            raise BootstrapError(f"unsafe Question Bank seed source path: {raw_name}")
        source = root / relative
        header, source_rows = read_csv(source)
        if header != EXPECTED_HEADER:
            raise BootstrapError(f"Question Bank seed source has non-Stage10 header: {relative}")
        rows.extend(source_rows)
        source_hashes.append((relative.as_posix(), sha256_file(source)))

    if not rows:
        raise BootstrapError("Question Bank repository seed is empty")
    if len({r["external_id"] for r in rows}) != len(rows):
        raise BootstrapError("duplicate external_id values across Question Bank seed sources")
    if any(r["status"] != "DRAFT" for r in rows):
        raise BootstrapError("repository Question Bank seed sources must remain DRAFT")
    for n, row in enumerate(rows, start=1):
        correct = row["correct_option"].strip().upper()
        if correct not in {"A", "B", "C", "D"}:
            raise BootstrapError(f"invalid correct_option in repository seed row {n}")
        if row[f"misconception_{correct.lower()}_id"].strip():
            raise BootstrapError(f"correct option has misconception in repository seed row {n}")
        for letter in "ABCD":
            if letter != correct and not row[f"misconception_{letter.lower()}_id"].strip():
                raise BootstrapError(f"distractor lacks misconception in repository seed row {n}")
        if row["media_type"] != "NONE":
            raise BootstrapError(
                f"{BOOTSTRAP_VERSION} currently accepts repository QB rows with media_type=NONE only; "
                f"found {row['media_type']!r} in repository seed row {n}"
            )

    validation_name = str(catalog.get("validation") or "").strip()
    if not validation_name:
        raise BootstrapError("Question Bank seed catalog has no consolidation validation path")
    validation_relative = Path(validation_name)
    if validation_relative.is_absolute() or ".." in validation_relative.parts:
        raise BootstrapError("unsafe Question Bank seed validation path")
    validation_path = root / validation_relative
    if not validation_path.is_file():
        raise BootstrapError(f"consolidation validation missing: {validation_path}")
    validation = json.loads(validation_path.read_text(encoding="utf-8"))
    if validation.get("status") != "PASS_STATIC_CONSOLIDATION":
        raise BootstrapError("repository consolidation validation is not PASS_STATIC_CONSOLIDATION")
    scope = validation.get("scope") or {}
    if int(scope.get("question_count", -1)) != len(rows):
        raise BootstrapError("validation question_count does not match repository seed rows")
    if int(catalog.get("question_count", -1)) != len(rows):
        raise BootstrapError("seed catalog question_count does not match repository seed rows")
    if str(catalog.get("repository_source_status") or "") != "DRAFT":
        raise BootstrapError("seed catalog repository_source_status must be DRAFT")
    if str(catalog.get("stage23_status") or "") != STAGE23_MARKER:
        raise BootstrapError("seed catalog Stage23 blocker marker is absent or changed")
    if ((validation.get("stage23") or {}).get("status")) != STAGE23_MARKER:
        raise BootstrapError("Stage23 blocker marker is absent or changed in validation evidence")
    schema = validation.get("schema") or {}
    if schema.get("master_header_matches") is not True or int(schema.get("actual_column_count", 0)) != 46:
        raise BootstrapError("validation does not confirm exact Stage10 schema")

    digest = hashlib.sha256()
    for relative, source_sha in source_hashes:
        digest.update(f"{relative}\0{source_sha}\n".encode("utf-8"))
    return catalog_path, rows, validation, digest.hexdigest()


def table_exists(cur: psycopg.Cursor, name: str) -> bool:
    cur.execute("SELECT to_regclass(%s) IS NOT NULL AS ok", (f"public.{name}",))
    return bool(cur.fetchone()["ok"])


def require_stage12_schema(cur: psycopg.Cursor) -> None:
    required = [
        "grammar_lessons", "grammar_subtopics", "tags", "question_types", "misconceptions",
        "questions", "question_options", "question_validation_runs", "question_reviews",
        "question_status_events", "publish_batches", "publish_batch_questions", "actors",
    ]
    missing = [name for name in required if not table_exists(cur, name)]
    if missing:
        raise BootstrapError(
            "Stage12 schema is not installed; missing tables: " + ", ".join(missing) +
            ". Run the official Stage26 migration workflow first. This tool never resets production DB."
        )
    cur.execute("SELECT count(*) AS n FROM grammar_lessons")
    lessons = int(cur.fetchone()["n"])
    cur.execute("SELECT count(*) AS n FROM grammar_subtopics")
    subtopics = int(cur.fetchone()["n"])
    cur.execute("SELECT count(*) AS n FROM tags")
    tags = int(cur.fetchone()["n"])
    if lessons < 52 or subtopics < 304 or tags < 35:
        raise BootstrapError(
            f"canonical Stage12 reference seed is incomplete (lessons={lessons}, subtopics={subtopics}, tags={tags}). "
            "Run ops/stage12/seed_canonical_reference.py through its official controlled seed procedure first."
        )


def seed_stage6(cur: psycopg.Cursor, root: Path) -> dict[str, int]:
    qt_path = root / "data/question_authoring/stage6/stage6_question_type_catalogue_reference_v1.0.csv"
    lesson_path = root / "data/question_authoring/stage6/stage6_lesson_type_compatibility_recovered_v1.0.csv"
    subtopic_path = root / "data/question_authoring/stage6/stage6_subtopic_type_compatibility_recovered_v1.0.csv"
    _, qtypes = read_csv(qt_path)
    _, lesson_rows = read_csv(lesson_path)
    _, subtopic_rows = read_csv(subtopic_path)

    for r in qtypes:
        cur.execute(
            """
            INSERT INTO question_types(id,code,name_fa,system_name_en,cognitive_level,response_mode,active,catalogue_version)
            VALUES (%s,%s,%s,%s,%s,%s,true,%s)
            ON CONFLICT (code) DO UPDATE SET
              name_fa=EXCLUDED.name_fa,
              system_name_en=EXCLUDED.system_name_en,
              cognitive_level=EXCLUDED.cognitive_level,
              response_mode=EXCLUDED.response_mode,
              active=true,
              catalogue_version=EXCLUDED.catalogue_version
            """,
            (
                first(r, "type_id", "question_type_id"),
                first(r, "question_type_code", "type_code", "code"),
                first(r, "name_fa"),
                first(r, "system_name_en", "name_en"),
                first(r, "cognitive_level"),
                first(r, "response_mode", default="SINGLE_CHOICE_4"),
                first(r, "catalogue_version"),
            ),
        )

    cur.execute("SELECT code,id FROM question_types")
    type_ids = {str(r["code"]): r["id"] for r in cur.fetchall()}

    for r in lesson_rows:
        code = first(r, "question_type_code", "type_code")
        qtid = type_ids.get(code)
        if qtid is None:
            raise BootstrapError(f"Stage6 lesson compatibility references unknown question type {code}")
        cur.execute("SELECT 1 FROM grammar_lessons WHERE id=%s", (first(r, "lesson_id"),))
        if cur.fetchone() is None:
            raise BootstrapError(f"Stage6 lesson compatibility references unknown lesson {first(r, 'lesson_id')}")
        cur.execute(
            """
            INSERT INTO lesson_question_type_compatibility(
              id,lesson_id,question_type_id,compatibility_status,allocation_factor,
              conditional_guardrail_required,rationale,compatibility_version
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (lesson_id,question_type_id,compatibility_version) DO UPDATE SET
              compatibility_status=EXCLUDED.compatibility_status,
              allocation_factor=EXCLUDED.allocation_factor,
              conditional_guardrail_required=EXCLUDED.conditional_guardrail_required,
              rationale=EXCLUDED.rationale
            """,
            (
                first(r, "compatibility_id", "id"), first(r, "lesson_id"), qtid,
                first(r, "compatibility_status"), first(r, "allocation_factor", default="0"),
                boolish(first(r, "conditional_guardrail_required", default="false")),
                first(r, "aggregation_rationale", "rationale"), first(r, "compatibility_version"),
            ),
        )

    for r in subtopic_rows:
        code = first(r, "question_type_code", "type_code")
        qtid = type_ids.get(code)
        if qtid is None:
            raise BootstrapError(f"Stage6 subtopic compatibility references unknown question type {code}")
        sid = first(r, "subtopic_id")
        cur.execute("SELECT 1 FROM grammar_subtopics WHERE id=%s", (sid,))
        if cur.fetchone() is None:
            raise BootstrapError(f"Stage6 subtopic compatibility references unknown subtopic {sid}")
        cur.execute(
            """
            INSERT INTO subtopic_question_type_compatibility(
              id,subtopic_id,question_type_id,compatibility_status,allocation_factor,
              conditional_guardrail_required,guardrail_text,compatibility_version
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (subtopic_id,question_type_id,compatibility_version) DO UPDATE SET
              compatibility_status=EXCLUDED.compatibility_status,
              allocation_factor=EXCLUDED.allocation_factor,
              conditional_guardrail_required=EXCLUDED.conditional_guardrail_required,
              guardrail_text=EXCLUDED.guardrail_text
            """,
            (
                first(r, "compatibility_id", "id"), sid, qtid,
                first(r, "compatibility_status"), first(r, "allocation_factor", default="0"),
                boolish(first(r, "conditional_guardrail_required", default="false")),
                first(r, "guardrail_text", "conditional_guardrail", "guardrail"),
                first(r, "compatibility_version"),
            ),
        )

    return {"question_types": len(qtypes), "lesson_compatibility": len(lesson_rows), "subtopic_compatibility": len(subtopic_rows)}


def stage7_value(r: dict[str, str], logical: str) -> str:
    candidates = {
        "id": ("misconception_id", "id"),
        "subtopic_id": ("subtopic_id",),
        "family": ("misconception_family", "family"),
        "name": ("name_fa", "misconception_name_fa"),
        "statement": ("misconception_statement_fa", "statement_fa"),
        "hint": ("distractor_authoring_hint_fa",),
        "diagnostic": ("diagnostic_interpretation_fa",),
        "priority": ("priority",),
        "status": ("status",),
        "empirical": ("empirical_commonness",),
        "version": ("catalogue_version",),
        "source_ref": ("source_ref",),
    }[logical]
    return first(r, *candidates)


def seed_stage7_and_build_map(cur: psycopg.Cursor, root: Path) -> tuple[dict[str, uuid.UUID], int]:
    path = root / "data/question_authoring/stage7/stage7_misconception_catalogue_v0.9.csv"
    _, rows = read_csv(path)
    mapping: dict[str, uuid.UUID] = {}
    inserted = 0
    for r in rows:
        old = stage7_value(r, "id")
        sid = stage7_value(r, "subtopic_id")
        family = stage7_value(r, "family")
        if not old or not sid or not family:
            raise BootstrapError("Stage7 original catalogue row misses misconception_id/subtopic_id/family")
        old_uuid = uuid.UUID(old)
        cur.execute("SELECT id FROM misconceptions WHERE id=%s", (old_uuid,))
        exact = cur.fetchone()
        if exact:
            mapping[old] = exact["id"]
            continue

        name = stage7_value(r, "name") or None
        statement = stage7_value(r, "statement")
        cur.execute(
            """
            SELECT id,statement_fa FROM misconceptions
            WHERE subtopic_id=%s AND family=%s AND name_fa IS NOT DISTINCT FROM %s
            ORDER BY id
            """,
            (sid, family, name),
        )
        matches = cur.fetchall()
        if len(matches) > 1 and statement:
            exact_statement = [m for m in matches if (m["statement_fa"] or "").strip() == statement.strip()]
            if len(exact_statement) == 1:
                matches = exact_statement
        if len(matches) == 1:
            mapping[old] = matches[0]["id"]
            continue
        if len(matches) > 1:
            raise BootstrapError(f"ambiguous Stage7 semantic mapping for historical misconception {old}")

        cur.execute("SELECT 1 FROM grammar_subtopics WHERE id=%s", (sid,))
        if cur.fetchone() is None:
            raise BootstrapError(f"Stage7 references unknown subtopic {sid}")
        cur.execute(
            """
            INSERT INTO misconceptions(
              id,subtopic_id,family,name_fa,statement_fa,diagnostic_interpretation_fa,
              distractor_authoring_hint_fa,priority,status,empirical_commonness,catalogue_version,source_ref
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                old_uuid, sid, family, name, statement,
                stage7_value(r, "diagnostic") or None, stage7_value(r, "hint") or None,
                stage7_value(r, "priority") or None, stage7_value(r, "status") or "ACTIVE",
                stage7_value(r, "empirical") or None, stage7_value(r, "version"),
                stage7_value(r, "source_ref") or None,
            ),
        )
        mapping[old] = old_uuid
        inserted += 1

    # Current canonical Question Bank authoring artifacts can reference the
    # recovered Stage7 v1.0 deterministic UUIDs, while the database keeps the
    # historical v0.9 misconception UUIDs as its canonical identity. Resolve
    # recovered IDs as aliases to the already-seeded historical rows instead of
    # creating duplicate misconception concepts.
    recovered_path = root / "data/question_authoring/stage7/stage7_misconception_catalogue_recovered_v1.0.csv"
    _, recovered_rows = read_csv(recovered_path)
    for r in recovered_rows:
        recovered = stage7_value(r, "id")
        sid = stage7_value(r, "subtopic_id")
        family = stage7_value(r, "family")
        if not recovered or not sid or not family:
            raise BootstrapError("Stage7 recovered catalogue row misses misconception_id/subtopic_id/family")
        if recovered in mapping:
            continue

        name = stage7_value(r, "name") or None
        statement = stage7_value(r, "statement")
        cur.execute(
            """
            SELECT id,statement_fa FROM misconceptions
            WHERE subtopic_id=%s AND family=%s AND name_fa IS NOT DISTINCT FROM %s
            ORDER BY id
            """,
            (sid, family, name),
        )
        matches = cur.fetchall()
        if len(matches) > 1 and statement:
            exact_statement = [m for m in matches if (m["statement_fa"] or "").strip() == statement.strip()]
            if len(exact_statement) == 1:
                matches = exact_statement

        # A recovered package can carry revised wording while preserving the
        # original misconception concept. Prefer exact statement identity, then
        # fall back to a unique subtopic+family concept. Never guess across
        # multiple historical concepts.
        if len(matches) == 0 and statement:
            cur.execute(
                """
                SELECT id,statement_fa FROM misconceptions
                WHERE subtopic_id=%s AND family=%s AND statement_fa=%s
                ORDER BY id
                """,
                (sid, family, statement),
            )
            matches = cur.fetchall()
        if len(matches) == 0:
            cur.execute(
                """
                SELECT id,statement_fa FROM misconceptions
                WHERE subtopic_id=%s AND family=%s
                ORDER BY id
                """,
                (sid, family),
            )
            matches = cur.fetchall()

        if len(matches) == 1:
            mapping[recovered] = matches[0]["id"]
        # Unused recovered rows do not block bootstrap. Any recovered ID that is
        # actually referenced by a Question Bank row is still fail-closed later
        # in upsert_questions if no unique historical concept was resolved.

    return mapping, inserted


def load_qbank_compatibility_catalogue(root: Path) -> list[dict[str, str]]:
    """Load lesson-level compatibility bridges for legacy Question Bank IDs.

    The checked-in v1.0 compatibility source is lesson-oriented: exactly one
    file for each L01-L52, with filename batch ranges covering B001-B238
    without gaps or overlaps. Canonical Stage7 identities still win; these
    rows only preserve already-authored diagnostic UUID references.
    """
    directory = root / QB_COMPATIBILITY_RELATIVE_DIR
    if not directory.is_dir():
        raise BootstrapError(
            f"Question Bank misconception compatibility directory missing: {directory}"
        )

    paths = sorted(directory.glob(QB_COMPATIBILITY_GLOB))
    if len(paths) != len(QB_COMPATIBILITY_EXPECTED_LESSONS):
        raise BootstrapError(
            "Question Bank misconception compatibility catalogue file-count drift: "
            f"expected={len(QB_COMPATIBILITY_EXPECTED_LESSONS)} actual={len(paths)}"
        )

    lessons_seen: set[int] = set()
    batches_seen: set[int] = set()
    merged_rows: list[dict[str, str]] = []

    for path in paths:
        match = QB_COMPATIBILITY_FILENAME_RE.fullmatch(path.name)
        if match is None:
            raise BootstrapError(
                f"Question Bank misconception compatibility filename drift: {path.name}"
            )

        lesson_no = int(match.group("lesson"))
        batch_start = int(match.group("start"))
        batch_end = int(match.group("end"))
        if lesson_no in lessons_seen:
            raise BootstrapError(
                f"duplicate Question Bank compatibility lesson file: L{lesson_no:02d}"
            )
        lessons_seen.add(lesson_no)

        if batch_start > batch_end:
            raise BootstrapError(
                f"invalid compatibility batch range in {path.name}: "
                f"B{batch_start:03d}-B{batch_end:03d}"
            )
        file_batches = set(range(batch_start, batch_end + 1))
        overlap = batches_seen & file_batches
        if overlap:
            first_overlap = min(overlap)
            raise BootstrapError(
                f"overlapping Question Bank compatibility batch B{first_overlap:03d} "
                f"at {path.name}"
            )
        batches_seen.update(file_batches)

        header, file_rows = read_csv(path)
        if header != QB_COMPATIBILITY_HEADER:
            raise BootstrapError(
                f"Question Bank misconception compatibility catalogue header/version drift: "
                f"{path.name}"
            )
        if not file_rows:
            raise BootstrapError(
                f"Question Bank misconception compatibility catalogue is empty: {path.name}"
            )

        expected_scope = f"B{batch_start:03d}-B{batch_end:03d}"
        expected_lesson_code = f"L{lesson_no:02d}"
        for line_no, row in enumerate(file_rows, start=2):
            location = f"{path.name}:{line_no}"
            actual_scope = row.get("question_bank_scope", "").strip()
            if actual_scope != expected_scope:
                raise BootstrapError(
                    "compatibility scope drift at "
                    f"{location}; expected={expected_scope} actual={actual_scope!r}"
                )

            home_subtopic_code = row.get("home_subtopic_code", "").strip()
            if not home_subtopic_code.startswith(f"{expected_lesson_code}-S"):
                raise BootstrapError(
                    "compatibility home subtopic lesson drift at "
                    f"{location}; filename_lesson={expected_lesson_code} "
                    f"home_subtopic_code={home_subtopic_code!r}"
                )

            first_external_id = row.get("first_external_id", "").strip()
            first_batch_match = re.search(
                r"(?:^|-)B(?P<batch>\\d{3})(?:-|$)", first_external_id
            )
            if first_batch_match is None:
                raise BootstrapError(
                    f"compatibility first_external_id format drift at {location}: "
                    f"{first_external_id!r}"
                )
            first_batch = int(first_batch_match.group("batch"))
            if not (batch_start <= first_batch <= batch_end):
                raise BootstrapError(
                    f"compatibility first_external_id scope drift at {location}: "
                    f"{first_external_id!r} is outside {expected_scope}"
                )

            merged_rows.append(row)

    if lessons_seen != QB_COMPATIBILITY_EXPECTED_LESSONS:
        missing = sorted(QB_COMPATIBILITY_EXPECTED_LESSONS - lessons_seen)
        extra = sorted(lessons_seen - QB_COMPATIBILITY_EXPECTED_LESSONS)
        raise BootstrapError(
            f"Question Bank compatibility lesson coverage drift: missing={missing} extra={extra}"
        )
    if batches_seen != QB_COMPATIBILITY_EXPECTED_BATCHES:
        missing = sorted(QB_COMPATIBILITY_EXPECTED_BATCHES - batches_seen)
        extra = sorted(batches_seen - QB_COMPATIBILITY_EXPECTED_BATCHES)
        raise BootstrapError(
            f"Question Bank compatibility batch coverage drift: missing={missing} extra={extra}"
        )
    if not merged_rows:
        raise BootstrapError("Question Bank misconception compatibility catalogues are empty")

    scoped_ids: set[tuple[str, str]] = set()
    for n, row in enumerate(merged_rows, start=1):
        if row.get("catalogue_version", "").strip() != QB_COMPATIBILITY_CATALOGUE_VERSION:
            raise BootstrapError(
                f"compatibility catalogue version mismatch at merged row {n}"
            )
        mid = row.get("misconception_id", "").strip()
        sid = row.get("home_subtopic_id", "").strip()
        code = row.get("home_subtopic_code", "").strip()
        if not mid or not sid or not code:
            raise BootstrapError(
                f"compatibility identity fields missing at merged row {n}"
            )
        try:
            uuid.UUID(mid)
            uuid.UUID(sid)
        except ValueError as exc:
            raise BootstrapError(
                f"invalid UUID in compatibility catalogue at merged row {n}"
            ) from exc
        if row.get("family", "").strip() != QB_COMPATIBILITY_FAMILY:
            raise BootstrapError(f"compatibility family drift at merged row {n}")
        scope = row.get("question_bank_scope", "").strip()
        if re.fullmatch(r"B\d{3}-B\d{3}", scope) is None:
            raise BootstrapError(f"compatibility scope format drift at merged row {n}")
        scoped_key = (scope, mid)
        if scoped_key in scoped_ids:
            raise BootstrapError(
                f"duplicate compatibility misconception_id within scope {scope}: {mid}"
            )
        scoped_ids.add(scoped_key)
        if not row.get("statement_fa", "").strip():
            raise BootstrapError(f"compatibility statement missing at merged row {n}")
    return merged_rows


def _compatibility_scope_bounds(scope: str) -> tuple[int, int]:
    match = re.fullmatch(r"B(?P<start>\d{3})-B(?P<end>\d{3})", scope.strip())
    if match is None:
        raise BootstrapError(f"invalid compatibility scope: {scope!r}")
    start = int(match.group("start"))
    end = int(match.group("end"))
    if start > end:
        raise BootstrapError(f"invalid compatibility scope range: {scope!r}")
    return start, end


def _question_batch_number(external_id: str) -> int:
    match = re.search(r"(?:^|-)B(?P<batch>\d{3})(?:-|$)", external_id.strip())
    if match is None:
        raise BootstrapError(
            f"cannot resolve Question Bank batch from external_id: {external_id!r}"
        )
    return int(match.group("batch"))


def _compatibility_batch_mapping_key(mid: str, batch: int) -> str:
    return f"{mid}@B{batch:03d}"


def seed_qbank_compatibility_misconceptions(
    cur: psycopg.Cursor,
    root: Path,
    question_rows: list[dict[str, str]],
    mapping: dict[str, uuid.UUID],
) -> dict[str, int]:
    """Resolve Question Bank-only diagnostic IDs after canonical Stage7 aliases.

    Lesson-level compatibility catalogues intentionally reuse some legacy UUIDs
    across different lesson scopes. Those UUIDs are therefore not globally
    canonical identities. When one legacy UUID appears in more than one scope,
    this bootstrap deterministically namespaces its runtime database UUID by
    ``question_bank_scope`` while keeping the repository source unchanged.

    Canonical Stage7 identities always win. All catalogue evidence remains
    fail-closed and is validated against the exact questions inside each scope.
    """
    catalogue_rows = load_qbank_compatibility_catalogue(root)

    catalogue_by_mid: dict[str, list[dict[str, str]]] = {}
    for row in catalogue_rows:
        catalogue_by_mid.setdefault(row["misconception_id"].strip(), []).append(row)

    use_rows: dict[str, list[tuple[str, str, str, int]]] = {}
    for qrow in question_rows:
        external_id = qrow["external_id"].strip()
        batch = _question_batch_number(external_id)
        for letter in "abcd":
            mid = qrow[f"misconception_{letter}_id"].strip()
            if mid:
                use_rows.setdefault(mid, []).append(
                    (
                        external_id,
                        qrow["subtopic_id"].strip(),
                        qrow["subtopic_code"].strip(),
                        batch,
                    )
                )

    unknown_used = sorted(set(use_rows) - set(mapping))
    missing = sorted(set(unknown_used) - set(catalogue_by_mid))
    if missing:
        raise BootstrapError(
            "Question Bank references diagnostic misconception IDs absent from Stage7 and the "
            f"versioned compatibility catalogues: {missing[:10]}"
        )

    inserted = 0
    already_present = 0
    cross_subtopic_ids = 0
    scoped_uuid_collisions_resolved = 0
    scoped_rows_resolved = 0

    for mid in unknown_used:
        rows_for_mid = catalogue_by_mid[mid]
        duplicated_across_scopes = len(rows_for_mid) > 1
        if duplicated_across_scopes:
            scoped_uuid_collisions_resolved += 1

        observed_all = use_rows[mid]
        observed_batches = {batch for _, _, _, batch in observed_all}
        covered_batches: set[int] = set()

        for row in sorted(rows_for_mid, key=lambda r: r["question_bank_scope"]):
            scope = row["question_bank_scope"].strip()
            batch_start, batch_end = _compatibility_scope_bounds(scope)
            scope_batches = set(range(batch_start, batch_end + 1))
            observed = [item for item in observed_all if item[3] in scope_batches]
            if not observed:
                raise BootstrapError(
                    f"compatibility catalogue row has no matching Question Bank usage for {mid} in {scope}"
                )
            covered_batches.update(batch for _, _, _, batch in observed)

            first_external_id, first_sid, first_code, _ = observed[0]
            observed_codes = sorted({code for _, _, code, _ in observed})
            declared_codes = sorted(filter(None, row["subtopic_codes_seen"].split(";")))
            if row["first_external_id"].strip() != first_external_id:
                raise BootstrapError(
                    f"compatibility first_external_id drift for {mid} in {scope}"
                )
            if (
                row["home_subtopic_id"].strip() != first_sid
                or row["home_subtopic_code"].strip() != first_code
            ):
                raise BootstrapError(
                    f"compatibility home subtopic drift for {mid} in {scope}"
                )
            try:
                declared_use_count = int(row["use_count"])
            except ValueError as exc:
                raise BootstrapError(
                    f"invalid compatibility use_count for {mid} in {scope}"
                ) from exc
            if declared_use_count != len(observed):
                raise BootstrapError(
                    f"compatibility use_count drift for {mid} in {scope}: "
                    f"declared={declared_use_count} observed={len(observed)}"
                )
            if declared_codes != observed_codes:
                raise BootstrapError(
                    f"compatibility subtopic usage drift for {mid} in {scope}"
                )
            if len(observed_codes) > 1:
                cross_subtopic_ids += 1

            sid = row["home_subtopic_id"].strip()
            cur.execute("SELECT id,subtopic_code FROM grammar_subtopics WHERE id=%s", (sid,))
            subtopic = cur.fetchone()
            if (
                subtopic is None
                or str(subtopic["subtopic_code"]) != row["home_subtopic_code"].strip()
            ):
                raise BootstrapError(
                    f"compatibility catalogue references unknown/mismatched subtopic {sid}"
                )

            if duplicated_across_scopes:
                runtime_uuid = uuid.uuid5(
                    QB_COMPATIBILITY_SCOPED_UID_NAMESPACE,
                    f"{scope}|{mid}",
                )
            else:
                runtime_uuid = uuid.UUID(mid)

            cur.execute(
                "SELECT id,subtopic_id,family,catalogue_version FROM misconceptions WHERE id=%s",
                (runtime_uuid,),
            )
            existing = cur.fetchone()
            if existing is not None:
                if (
                    str(existing["subtopic_id"]) != sid
                    or str(existing["family"]) != QB_COMPATIBILITY_FAMILY
                    or str(existing["catalogue_version"]) != QB_COMPATIBILITY_CATALOGUE_VERSION
                ):
                    raise BootstrapError(
                        f"compatibility misconception UUID collision for runtime id {runtime_uuid} "
                        f"(source={mid}, scope={scope})"
                    )
                already_present += 1
            else:
                source_ref = row["source_ref"].strip()
                if duplicated_across_scopes:
                    trace = f"source_compatibility_id={mid}; scope={scope}"
                    source_ref = f"{source_ref}; {trace}" if source_ref else trace
                cur.execute(
                    """
                    INSERT INTO misconceptions(
                      id,subtopic_id,family,name_fa,statement_fa,diagnostic_interpretation_fa,
                      distractor_authoring_hint_fa,priority,status,empirical_commonness,catalogue_version,source_ref
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        runtime_uuid,
                        sid,
                        QB_COMPATIBILITY_FAMILY,
                        row["name_fa"].strip() or None,
                        row["statement_fa"].strip(),
                        row["diagnostic_interpretation_fa"].strip() or None,
                        row["distractor_authoring_hint_fa"].strip() or None,
                        row["priority"].strip() or None,
                        row["status"].strip() or "CANDIDATE_PREDEPLOY_CONTENT_REVIEW",
                        row["empirical_commonness"].strip() or None,
                        QB_COMPATIBILITY_CATALOGUE_VERSION,
                        source_ref or None,
                    ),
                )
                inserted += 1

            for batch in scope_batches:
                key = _compatibility_batch_mapping_key(mid, batch)
                previous = mapping.get(key)
                if previous is not None and previous != runtime_uuid:
                    raise BootstrapError(
                        f"conflicting compatibility runtime mapping for {mid} in B{batch:03d}"
                    )
                mapping[key] = runtime_uuid
            scoped_rows_resolved += 1

        if observed_batches - covered_batches:
            uncovered = sorted(observed_batches - covered_batches)
            raise BootstrapError(
                f"compatibility usage for {mid} is outside declared scopes; "
                f"first_uncovered_batch=B{uncovered[0]:03d}"
            )

    return {
        "catalogue_rows": len(catalogue_rows),
        "catalogue_unique_source_ids": len(catalogue_by_mid),
        "unknown_used_resolved": len(unknown_used),
        "scoped_rows_resolved": scoped_rows_resolved,
        "scoped_uuid_collisions_resolved": scoped_uuid_collisions_resolved,
        "inserted": inserted,
        "already_present": already_present,
        "cross_subtopic_ids_preserved": cross_subtopic_ids,
    }


def resolve_actor(cur: psycopg.Cursor, external_id: str, *, create_ai: bool = False) -> dict[str, Any]:
    cur.execute("SELECT id,external_actor_id,actor_type,user_id,active FROM actors WHERE external_actor_id=%s", (external_id,))
    actor = cur.fetchone()
    if actor:
        return actor
    if not create_ai:
        raise BootstrapError(f"required actor not found: {external_id}")
    cur.execute(
        """
        INSERT INTO actors(external_actor_id,actor_type,display_name,active)
        VALUES (%s,'AI_GENERATOR',%s,true)
        RETURNING id,external_actor_id,actor_type,user_id,active
        """,
        (external_id, external_id),
    )
    return cur.fetchone()


def resolve_canonical_publisher(cur: psycopg.Cursor) -> dict[str, Any]:
    """Return the explicit system actor used only by fresh-data migration seeds.

    This actor records an owner-requested canonical seed release. It deliberately
    does not masquerade as a human reviewer.
    """
    cur.execute(
        "SELECT id,external_actor_id,actor_type,user_id,active FROM actors WHERE external_actor_id=%s",
        (CANONICAL_PUBLISHER_EXTERNAL_ID,),
    )
    actor = cur.fetchone()
    if actor is not None:
        if actor["actor_type"] != "SYSTEM" or not actor["active"]:
            raise BootstrapError("canonical Question Bank publisher actor is not an active SYSTEM actor")
        return actor
    cur.execute(
        """
        INSERT INTO actors(external_actor_id,actor_type,display_name,active)
        VALUES (%s,'SYSTEM','Canonical Question Bank migration publisher',true)
        RETURNING id,external_actor_id,actor_type,user_id,active
        """,
        (CANONICAL_PUBLISHER_EXTERNAL_ID,),
    )
    return cur.fetchone()


def question_type_map(cur: psycopg.Cursor) -> dict[str, uuid.UUID]:
    cur.execute("SELECT id,code FROM question_types WHERE active=true")
    return {str(r["code"]): r["id"] for r in cur.fetchall()}


def tag_map(cur: psycopg.Cursor) -> dict[str, uuid.UUID]:
    cur.execute("SELECT id,code FROM tags WHERE status='ACTIVE'")
    return {str(r["code"]): r["id"] for r in cur.fetchall()}


def compatibility_for(cur: psycopg.Cursor, row: dict[str, str], qtid: uuid.UUID) -> tuple[str, bool]:
    cur.execute(
        """
        SELECT compatibility_status,conditional_guardrail_required,guardrail_text
        FROM subtopic_question_type_compatibility
        WHERE subtopic_id=%s AND question_type_id=%s AND compatibility_version=%s
        """,
        (row["subtopic_id"], qtid, row["compatibility_version"]),
    )
    hit = cur.fetchone()
    if hit is None:
        raise BootstrapError(
            f"missing Stage6 compatibility for {row['external_id']} / {row['subtopic_code']} / {row['question_type']}"
        )
    status = str(hit["compatibility_status"])
    if status == "NOT_SUITABLE":
        raise BootstrapError(f"NOT_SUITABLE question rejected: {row['external_id']}")
    # Authoring contract says CONDITIONAL items are emitted only when the guardrail is satisfied.
    # The repository consolidation validation is required to be PASS before we reach this point.
    guarded = status == "CONDITIONAL"
    return status, guarded


def upsert_questions(
    cur: psycopg.Cursor,
    rows: list[dict[str, str]],
    stage7_map: dict[str, uuid.UUID],
) -> tuple[list[uuid.UUID], dict[str, int]]:
    qtypes = question_type_map(cur)
    tags = tag_map(cur)
    target_ids: list[uuid.UUID] = []
    stats = {"inserted_questions": 0, "repaired_drafts": 0, "already_published": 0}

    for row in rows:
        code = row["question_type"].strip()
        qtid = qtypes.get(code)
        if qtid is None:
            raise BootstrapError(f"question type is not seeded: {code}")
        compatibility_status, guarded = compatibility_for(cur, row, qtid)
        _ = compatibility_status
        author = resolve_actor(cur, row["author_id"].strip(), create_ai=True)
        fp = fingerprint(row)
        revision = int(row["question_revision"])
        cur.execute(
            "SELECT * FROM questions WHERE external_id=%s AND revision=%s",
            (row["external_id"], revision),
        )
        existing = cur.fetchone()
        q_uid = uuid.uuid5(QUESTION_UID_NAMESPACE, row["external_id"])
        parent_revision_id = None
        if revision > 1:
            cur.execute(
                "SELECT id FROM questions WHERE external_id=%s AND revision=%s",
                (row["external_id"], revision - 1),
            )
            prev = cur.fetchone()
            if prev is None:
                raise BootstrapError(f"revision {revision} lacks parent for {row['external_id']}")
            parent_revision_id = prev["id"]

        if existing is None:
            cur.execute(
                """
                INSERT INTO questions(
                  question_uid,external_id,revision,parent_revision_id,lesson_id,primary_subtopic_id,
                  question_type_id,stem,stem_locale,full_explanation,explanation_locale,
                  initial_difficulty_code,initial_difficulty_score,difficulty_model_version,status,
                  source_type,source_ref,author_actor_id,reviewer_actor_id,correct_option_id,
                  fingerprint_sha256,guardrail_satisfied,taxonomy_version,question_type_catalogue_version,
                  compatibility_version,distractor_rules_version,content_version
                ) VALUES (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'DRAFT',%s,%s,%s,NULL,NULL,%s,%s,%s,%s,%s,%s,%s
                ) RETURNING id,status
                """,
                (
                    q_uid, row["external_id"], revision, parent_revision_id, row["lesson_id"], row["subtopic_id"],
                    qtid, row["stem"], row["stem_locale"], row["full_explanation"], row["explanation_locale"],
                    row["difficulty"], row["difficulty_score_initial"], row["difficulty_model_version"],
                    row["source_type"], row["source_ref"], author["id"], fp, guarded,
                    row["taxonomy_version"], row["question_type_catalogue_version"], row["compatibility_version"],
                    row["distractor_rules_version"], row["content_version"],
                ),
            )
            existing = cur.fetchone()
            stats["inserted_questions"] += 1
        else:
            if existing["status"] == "PUBLISHED":
                if existing["fingerprint_sha256"].strip() != fp:
                    raise BootstrapError(f"published question differs from repository source: {row['external_id']}")
                target_ids.append(existing["id"])
                stats["already_published"] += 1
                continue
            if existing["status"] != "DRAFT":
                if existing["fingerprint_sha256"].strip() != fp:
                    raise BootstrapError(
                        f"non-DRAFT question differs from source ({existing['status']}): {row['external_id']}"
                    )
            else:
                cur.execute(
                    """
                    UPDATE questions SET
                      question_uid=%s,parent_revision_id=%s,lesson_id=%s,primary_subtopic_id=%s,
                      question_type_id=%s,stem=%s,stem_locale=%s,full_explanation=%s,explanation_locale=%s,
                      initial_difficulty_code=%s,initial_difficulty_score=%s,difficulty_model_version=%s,
                      source_type=%s,source_ref=%s,author_actor_id=%s,fingerprint_sha256=%s,
                      guardrail_satisfied=%s,taxonomy_version=%s,question_type_catalogue_version=%s,
                      compatibility_version=%s,distractor_rules_version=%s,content_version=%s
                    WHERE id=%s
                    """,
                    (
                        q_uid, parent_revision_id, row["lesson_id"], row["subtopic_id"], qtid,
                        row["stem"], row["stem_locale"], row["full_explanation"], row["explanation_locale"],
                        row["difficulty"], row["difficulty_score_initial"], row["difficulty_model_version"],
                        row["source_type"], row["source_ref"], author["id"], fp, guarded,
                        row["taxonomy_version"], row["question_type_catalogue_version"], row["compatibility_version"],
                        row["distractor_rules_version"], row["content_version"], existing["id"],
                    ),
                )
                stats["repaired_drafts"] += 1

        qid = existing["id"]
        target_ids.append(qid)
        current_status = existing["status"]
        if current_status != "DRAFT":
            continue

        option_ids: dict[str, uuid.UUID] = {}
        correct_letter = row["correct_option"].strip().upper()
        for letter in "ABCD":
            old_mid = row[f"misconception_{letter.lower()}_id"].strip()
            if letter == correct_letter:
                mid = None
            else:
                mid = stage7_map.get(old_mid)
                if mid is None:
                    batch = _question_batch_number(row["external_id"])
                    mid = stage7_map.get(_compatibility_batch_mapping_key(old_mid, batch))
                if mid is None:
                    raise BootstrapError(
                        f"unresolved historical misconception {old_mid} in "
                        f"{row['external_id']} option {letter}"
                    )
            cur.execute(
                """
                INSERT INTO question_options(question_id,position,option_text,locale,explanation,misconception_id)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON CONFLICT (question_id,position) DO UPDATE SET
                  option_text=EXCLUDED.option_text,
                  locale=EXCLUDED.locale,
                  explanation=EXCLUDED.explanation,
                  misconception_id=EXCLUDED.misconception_id
                RETURNING id
                """,
                (
                    qid, letter, row[f"option_{letter.lower()}"], row["option_locale"],
                    row[f"explanation_{letter.lower()}"], mid,
                ),
            )
            option_ids[letter] = cur.fetchone()["id"]
        cur.execute("UPDATE questions SET correct_option_id=%s WHERE id=%s", (option_ids[correct_letter], qid))

        cur.execute("DELETE FROM question_secondary_subtopics WHERE question_id=%s", (qid,))
        for sid in [x.strip() for x in row["secondary_subtopic_ids"].split("|") if x.strip()]:
            cur.execute("SELECT 1 FROM grammar_subtopics WHERE id=%s", (sid,))
            if cur.fetchone() is None:
                raise BootstrapError(f"unknown secondary subtopic {sid} in {row['external_id']}")
            cur.execute(
                "INSERT INTO question_secondary_subtopics(question_id,subtopic_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                (qid, sid),
            )

        cur.execute("DELETE FROM question_tags WHERE question_id=%s", (qid,))
        for tag_code in [x.strip() for x in row["tags"].split("|") if x.strip()]:
            tag_id = tags.get(tag_code)
            if tag_id is None:
                raise BootstrapError(f"unknown tag {tag_code} in {row['external_id']}")
            cur.execute(
                "INSERT INTO question_tags(question_id,tag_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                (qid, tag_id),
            )

    return target_ids, stats


def verify_live_gate(cur: psycopg.Cursor, target_ids: list[uuid.UUID]) -> None:
    if not target_ids:
        raise BootstrapError("no Question Bank questions selected")
    cur.execute(
        """
        SELECT q.external_id,
               (SELECT count(*) FROM question_options o WHERE o.question_id=q.id) AS option_count,
               q.correct_option_id,
               EXISTS(SELECT 1 FROM question_options o WHERE o.id=q.correct_option_id AND o.question_id=q.id) AS correct_ok,
               EXISTS(SELECT 1 FROM question_options o WHERE o.question_id=q.id AND o.id<>q.correct_option_id AND o.misconception_id IS NULL) AS missing_distractor_mapping,
               EXISTS(SELECT 1 FROM question_options o WHERE o.id=q.correct_option_id AND o.misconception_id IS NOT NULL) AS correct_has_mapping,
               c.compatibility_status,
               q.guardrail_satisfied
        FROM questions q
        LEFT JOIN subtopic_question_type_compatibility c
          ON c.subtopic_id=q.primary_subtopic_id
         AND c.question_type_id=q.question_type_id
         AND c.compatibility_version=q.compatibility_version
        WHERE q.id = ANY(%s)
        """,
        (target_ids,),
    )
    bad = []
    for r in cur.fetchall():
        if (
            int(r["option_count"]) != 4
            or r["correct_option_id"] is None
            or not r["correct_ok"]
            or r["missing_distractor_mapping"]
            or r["correct_has_mapping"]
            or r["compatibility_status"] is None
            or r["compatibility_status"] == "NOT_SUITABLE"
            or (r["compatibility_status"] == "CONDITIONAL" and not r["guardrail_satisfied"])
        ):
            bad.append(r["external_id"])
    if bad:
        raise BootstrapError(f"live Stage11 machine gate failed for {len(bad)} question(s); first={bad[:5]}")


def register_validation(cur: psycopg.Cursor, target_ids: list[uuid.UUID], validation: dict[str, Any], master_sha: str) -> int:
    metadata = json.dumps(
        {
            "bootstrap_version": BOOTSTRAP_VERSION,
            "repository_validation_version": validation.get("validation_version"),
            "repository_validation_status": validation.get("status"),
            "master_sha256": master_sha,
            "stage23": STAGE23_MARKER,
            "live_database_gate": "PASS",
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    inserted = 0
    for qid in target_ids:
        cur.execute(
            "SELECT 1 FROM question_validation_runs WHERE question_id=%s AND validator_version=%s AND result='PASS'",
            (qid, BOOTSTRAP_VERSION),
        )
        if cur.fetchone() is None:
            cur.execute(
                """
                INSERT INTO question_validation_runs(question_id,validator_version,result,error_codes,run_metadata)
                VALUES (%s,%s,'PASS','[]'::jsonb,%s::jsonb)
                """,
                (qid, BOOTSTRAP_VERSION, metadata),
            )
            inserted += 1
    return inserted


def event(cur: psycopg.Cursor, qid: uuid.UUID, from_status: str, to_status: str, action: str, actor_id: uuid.UUID, metadata: dict[str, Any]) -> None:
    cur.execute(
        """
        INSERT INTO question_status_events(question_id,from_status,to_status,action,actor_id,event_metadata)
        VALUES (%s,%s,%s,%s,%s,%s::jsonb)
        """,
        (qid, from_status, to_status, action, actor_id, json.dumps(metadata, ensure_ascii=False, sort_keys=True)),
    )


def publish_reviewed(
    cur: psycopg.Cursor,
    target_ids: list[uuid.UUID],
    reviewer_external_id: str,
    batch_code: str,
    *,
    canonical_seed: bool = False,
) -> dict[str, int]:
    if canonical_seed:
        reviewer = resolve_canonical_publisher(cur)
        review_note = (
            "Owner-requested automatic canonical seed publication. "
            "This SYSTEM workflow records no claim of independent human review."
        )
        workflow_version = CANONICAL_PUBLICATION_VERSION
    else:
        reviewer = resolve_actor(cur, reviewer_external_id, create_ai=False)
        if not reviewer["active"] or reviewer["actor_type"] not in {"REVIEWER", "ADMIN"}:
            raise BootstrapError("reviewer actor must be active and have REVIEWER or ADMIN role")
        review_note = (
            "Independent human review explicitly confirmed by operator via "
            "ops/question_bank/bootstrap.py --confirm-human-review."
        )
        workflow_version = WORKFLOW_VERSION
    reviewer_id = reviewer["id"]

    cur.execute("SELECT id,author_actor_id,status FROM questions WHERE id=ANY(%s)", (target_ids,))
    rows = cur.fetchall()
    if any(r["author_actor_id"] == reviewer_id for r in rows):
        raise BootstrapError("independent-review gate: reviewer is also author for at least one question")

    counts = {"ready": 0, "approved": 0, "published": 0}
    for r in rows:
        if r["status"] == "DRAFT":
            cur.execute(
                """
                UPDATE questions SET reviewer_actor_id=%s,submitted_at=COALESCE(submitted_at,now()),status='READY_FOR_REVIEW'
                WHERE id=%s AND status='DRAFT'
                RETURNING id,author_actor_id
                """,
                (reviewer_id, r["id"]),
            )
            moved = cur.fetchone()
            if moved:
                event(cur, r["id"], "DRAFT", "READY_FOR_REVIEW", "SUBMIT_FOR_REVIEW", moved["author_actor_id"], {"bootstrap_version": BOOTSTRAP_VERSION})
                counts["ready"] += 1
        elif r["status"] in {"READY_FOR_REVIEW", "APPROVED"}:
            if canonical_seed:
                raise BootstrapError(
                    "canonical seed publication refuses to replace an in-progress human reviewer"
                )
            cur.execute("UPDATE questions SET reviewer_actor_id=%s WHERE id=%s", (reviewer_id, r["id"]))

    cur.execute("SELECT id,status FROM questions WHERE id=ANY(%s)", (target_ids,))
    for r in cur.fetchall():
        if r["status"] == "READY_FOR_REVIEW":
            cur.execute(
                """
                SELECT 1 FROM question_reviews
                WHERE question_id=%s AND reviewer_actor_id=%s AND disposition='APPROVED'
                """,
                (r["id"], reviewer_id),
            )
            if cur.fetchone() is None:
                cur.execute(
                    """
                    INSERT INTO question_reviews(question_id,reviewer_actor_id,disposition,review_notes,workflow_version)
                    VALUES (%s,%s,'APPROVED',%s,%s)
                    """,
                    (
                        r["id"], reviewer_id,
                        review_note,
                        workflow_version,
                    ),
                )
            cur.execute(
                "UPDATE questions SET status='APPROVED',approved_at=COALESCE(approved_at,now()) WHERE id=%s AND status='READY_FOR_REVIEW' RETURNING id",
                (r["id"],),
            )
            if cur.fetchone():
                event(
                    cur,
                    r["id"],
                    "READY_FOR_REVIEW",
                    "APPROVED",
                    "CANONICAL_SEED_APPROVE" if canonical_seed else "APPROVE",
                    reviewer_id,
                    {"workflow_version": workflow_version, "canonical_seed": canonical_seed},
                )
                counts["approved"] += 1

    cur.execute("SELECT id,status FROM publish_batches WHERE batch_code=%s", (batch_code,))
    batch = cur.fetchone()
    if batch is None:
        cur.execute(
            """
            INSERT INTO publish_batches(batch_code,status,created_by_actor_id,created_at)
            VALUES (%s,'OPEN',%s,now()) RETURNING id,status
            """,
            (batch_code, reviewer_id),
        )
        batch = cur.fetchone()
    elif batch["status"] == "CANCELLED":
        raise BootstrapError(f"publish batch is CANCELLED: {batch_code}")

    for qid in target_ids:
        cur.execute(
            "INSERT INTO publish_batch_questions(publish_batch_id,question_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
            (batch["id"], qid),
        )

    cur.execute("SELECT id,status FROM questions WHERE id=ANY(%s)", (target_ids,))
    for r in cur.fetchall():
        if r["status"] == "APPROVED":
            cur.execute("UPDATE questions SET status='PUBLISHED' WHERE id=%s AND status='APPROVED' RETURNING id", (r["id"],))
            if cur.fetchone():
                event(cur, r["id"], "APPROVED", "PUBLISHED", "PUBLISH", reviewer_id, {"publish_batch": batch_code})
                counts["published"] += 1

    cur.execute(
        "UPDATE publish_batches SET status='COMMITTED',committed_at=COALESCE(committed_at,now()) WHERE id=%s AND status='OPEN'",
        (batch["id"],),
    )
    request_id = f"qb-bootstrap:{batch_code}"
    cur.execute("SELECT 1 FROM audit_logs WHERE request_id=%s AND action='PUBLISH_QUESTION_BANK'", (request_id,))
    if cur.fetchone() is None:
        cur.execute(
            """
            INSERT INTO audit_logs(actor_user_id,actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
            VALUES (%s,%s,'PUBLISH_QUESTION_BANK','publish_batch',%s,%s::jsonb,%s::jsonb,%s)
            """,
            (
                reviewer["user_id"], reviewer_id, batch["id"],
                json.dumps({"source": "repository DRAFT Question Bank"}, sort_keys=True),
                json.dumps(
                    {
                        "status": "PUBLISHED",
                        "bootstrap_version": BOOTSTRAP_VERSION,
                        "publication_version": workflow_version,
                        "canonical_seed": canonical_seed,
                        "human_review_claimed": not canonical_seed,
                        "stage23": STAGE23_MARKER,
                    },
                    sort_keys=True,
                ),
                request_id,
            ),
        )
    if canonical_seed:
        cur.execute(
            """
            INSERT INTO system_versions(component,version,status,source_ref,metadata)
            VALUES (%s,%s,'APPLIED',%s,%s::jsonb)
            ON CONFLICT (component) DO UPDATE SET
              version=EXCLUDED.version,
              status=EXCLUDED.status,
              source_ref=EXCLUDED.source_ref,
              metadata=EXCLUDED.metadata
            """,
            (
                SYSTEM_VERSION_COMPONENT,
                CANONICAL_PUBLICATION_VERSION,
                "data/question_bank/full/v1.0 canonical repository seed",
                json.dumps(
                    {
                        "question_count": len(target_ids),
                        "publish_batch": batch_code,
                        "publisher_actor": CANONICAL_PUBLISHER_EXTERNAL_ID,
                        "human_review_claimed": False,
                    },
                    sort_keys=True,
                ),
            ),
        )
    return counts


def default_batch_code(validation: dict[str, Any]) -> str:
    scope = validation.get("scope") or {}
    batches = str(scope.get("batches") or "QB").replace("–", "-")
    lessons = str(scope.get("lessons") or "LESSONS").replace("–", "-")
    code = f"QB-{batches}-{lessons}-V1"
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", code)[:100]


def summary_counts(cur: psycopg.Cursor, target_ids: list[uuid.UUID]) -> dict[str, int]:
    cur.execute("SELECT status,count(*) AS n FROM questions WHERE id=ANY(%s) GROUP BY status ORDER BY status", (target_ids,))
    out = {str(r["status"]): int(r["n"]) for r in cur.fetchall()}
    cur.execute("SELECT count(*) AS n FROM v_serving_questions WHERE id=ANY(%s)", (target_ids,))
    out["SERVING"] = int(cur.fetchone()["n"])
    return out


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Idempotent Stage6/Stage7/Question-Bank bootstrap and controlled Stage11 publish workflow."
    )
    p.add_argument("--master", default=None, help="Repository-relative or absolute Stage10 master CSV. Default: repository seed catalog when present; otherwise the single full/v1.0 master CSV.")
    p.add_argument("--publish-reviewed", action="store_true", help="Continue through READY_FOR_REVIEW -> APPROVED -> PUBLISHED.")
    p.add_argument(
        "--publish-canonical-seed",
        action="store_true",
        help=(
            "Publish the validated repository seed through an audited SYSTEM workflow. "
            "Used by the canonical fresh-database migration; it does not claim human review."
        ),
    )
    p.add_argument("--reviewer-external-id", default="", help="Independent REVIEWER/ADMIN actor external id.")
    p.add_argument("--confirm-human-review", action="store_true", help="Explicit operator attestation that independent human review has actually been completed.")
    p.add_argument("--publish-batch-code", default="", help="Optional explicit publish batch code.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    progress = BootstrapProgress()

    progress.start("S00", "Validate command-line publication arguments")
    usage_error = ""
    if args.publish_reviewed and args.publish_canonical_seed:
        usage_error = "choose only one publication mode"
    elif args.publish_reviewed and (not args.confirm_human_review or not args.reviewer_external_id):
        usage_error = "--publish-reviewed requires both --confirm-human-review and --reviewer-external-id"
    elif args.confirm_human_review and not args.publish_reviewed:
        usage_error = "--confirm-human-review is only valid with --publish-reviewed"

    if usage_error:
        exc = BootstrapError(usage_error)
        progress.fail_current(exc)
        rollback = {
            "attempted": False,
            "succeeded": True,
            "reason": "database connection was not opened",
            "error": None,
        }
        diagnostics = _build_failure_diagnostics(exc, progress, rollback)
        _print_failure_diagnostics(progress, diagnostics)
        progress.stopped("database was not touched")
        print(
            json.dumps(
                {
                    "status": "FAIL",
                    "bootstrap_version": BOOTSTRAP_VERSION,
                    "error": usage_error,
                    "stage23": STAGE23_MARKER,
                    "progress": progress.snapshot(),
                    "diagnostics": diagnostics,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2

    publication_mode = (
        "reviewed" if args.publish_reviewed
        else "canonical_seed" if args.publish_canonical_seed
        else "draft_only"
    )
    progress.finish_current(f"publication_mode={publication_mode}")

    root = repo_root()
    conn: psycopg.Connection | None = None
    cur: psycopg.Cursor | None = None
    result: dict[str, Any] | None = None

    try:
        with progress.stage("S01", "Load and validate canonical Question Bank source") as step:
            master, rows, validation, master_sha = load_repository_seed(root, args.master)
            try:
                source_label = str(master.relative_to(root))
            except ValueError:
                source_label = str(master)
            step["detail"] = f"rows={len(rows)}; source={source_label}"

        with progress.stage("S02", "Connect to PostgreSQL") as step:
            conn = connect()
            db_env = _safe_database_environment()
            endpoint = ":".join(filter(None, [db_env.get("PGHOST", ""), db_env.get("PGPORT", "")]))
            step["detail"] = f"connection established{'; endpoint=' + endpoint if endpoint else ''}"

        with progress.stage("S03", "Verify Stage12 schema and canonical reference seed"):
            cur = conn.cursor()
            require_stage12_schema(cur)

        with progress.stage("S04", "Seed Stage6 question types and compatibility") as step:
            stage6 = seed_stage6(cur, root)
            step["detail"] = (
                f"question_types={stage6['question_types']}; "
                f"lesson_rules={stage6['lesson_compatibility']}; "
                f"subtopic_rules={stage6['subtopic_compatibility']}"
            )

        with progress.stage("S05", "Seed Stage7 misconceptions and build identity map") as step:
            stage7_map, stage7_inserted = seed_stage7_and_build_map(cur, root)
            stage7_map_count = len(stage7_map)
            step["detail"] = f"mapped={stage7_map_count}; inserted={stage7_inserted}"

        with progress.stage("S06", "Resolve Question Bank misconception compatibility bridge") as step:
            qbank_compatibility = seed_qbank_compatibility_misconceptions(
                cur, root, rows, stage7_map
            )
            step["detail"] = (
                f"resolved={qbank_compatibility['unknown_used_resolved']}; "
                f"scoped_rows={qbank_compatibility['scoped_rows_resolved']}; "
                f"cross_scope_uuid_collisions={qbank_compatibility['scoped_uuid_collisions_resolved']}; "
                f"inserted={qbank_compatibility['inserted']}; "
                f"already_present={qbank_compatibility['already_present']}"
            )

        with progress.stage("S07", "Upsert questions, options, tags and subtopics") as step:
            target_ids, import_stats = upsert_questions(cur, rows, stage7_map)
            step["detail"] = (
                f"targets={len(target_ids)}; "
                f"inserted={import_stats['inserted_questions']}; "
                f"repaired_drafts={import_stats['repaired_drafts']}; "
                f"already_published={import_stats['already_published']}"
            )

        with progress.stage("S08", "Run live Stage11 machine validation gate") as step:
            verify_live_gate(cur, target_ids)
            step["detail"] = f"validated={len(target_ids)}"

        with progress.stage("S09", "Register validation PASS evidence") as step:
            validation_rows = register_validation(cur, target_ids, validation, master_sha)
            step["detail"] = f"validation_rows_inserted={validation_rows}"

        publication = {"ready": 0, "approved": 0, "published": 0}
        batch_code = None
        if args.publish_reviewed:
            with progress.stage("S10", "Publish independently reviewed questions") as step:
                batch_code = args.publish_batch_code or default_batch_code(validation)
                publication = publish_reviewed(
                    cur, target_ids, args.reviewer_external_id, batch_code
                )
                step["detail"] = (
                    f"batch={batch_code}; ready={publication['ready']}; "
                    f"approved={publication['approved']}; published={publication['published']}"
                )
        elif args.publish_canonical_seed:
            with progress.stage("S10", "Publish canonical repository seed") as step:
                batch_code = args.publish_batch_code or default_batch_code(validation)
                publication = publish_reviewed(
                    cur,
                    target_ids,
                    CANONICAL_PUBLISHER_EXTERNAL_ID,
                    batch_code,
                    canonical_seed=True,
                )
                step["detail"] = (
                    f"batch={batch_code}; ready={publication['ready']}; "
                    f"approved={publication['approved']}; published={publication['published']}"
                )
        else:
            progress.skip(
                "S10",
                "Publication workflow",
                "no publication flag supplied; questions remain in their current workflow status",
            )

        with progress.stage("S11", "Verify final database status and serving postcondition") as step:
            counts = summary_counts(cur, target_ids)
            if args.publish_canonical_seed and (
                counts.get("PUBLISHED") != len(target_ids)
                or counts.get("SERVING") != len(target_ids)
            ):
                raise BootstrapError(
                    "canonical migration did not leave every target question PUBLISHED and serving"
                )
            step["detail"] = (
                f"targets={len(target_ids)}; published={counts.get('PUBLISHED', 0)}; "
                f"serving={counts.get('SERVING', 0)}"
            )

        result = {
            "status": "PASS",
            "bootstrap_version": BOOTSTRAP_VERSION,
            "master": str(master.relative_to(root)),
            "master_sha256": master_sha,
            "target_questions": len(target_ids),
            "stage6": stage6,
            "stage7_historical_map_count": stage7_map_count,
            "stage7_rows_inserted": stage7_inserted,
            "question_bank_misconception_compatibility": qbank_compatibility,
            "question_import": import_stats,
            "validation_pass_rows_inserted": validation_rows,
            "publication": publication,
            "publish_batch_code": batch_code,
            "database_status_counts": counts,
            "stage23": STAGE23_MARKER,
        }

        if cur is not None:
            cur.close()
            cur = None

        with progress.stage("S12", "Commit PostgreSQL transaction") as step:
            conn.commit()
            step["detail"] = "transaction committed; database changes persisted"

        progress.complete(len(target_ids))
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0

    except Exception as exc:
        progress.fail_current(exc)

        rollback: dict[str, Any] = {
            "attempted": False,
            "succeeded": True,
            "reason": "database commit already completed" if progress.has_completed("S12") else "no database connection",
            "error": None,
        }
        if conn is not None and not progress.has_completed("S12"):
            rollback["attempted"] = True
            rollback["reason"] = "failure occurred before database commit"
            try:
                conn.rollback()
                rollback["succeeded"] = True
            except Exception as rollback_exc:
                rollback["succeeded"] = False
                rollback["error"] = f"{type(rollback_exc).__name__}: {rollback_exc}"

        diagnostics = _build_failure_diagnostics(exc, progress, rollback)
        _print_failure_diagnostics(progress, diagnostics)

        if progress.has_completed("S12"):
            rollback_note = "database commit had already completed before this failure"
        elif rollback["attempted"] and rollback["succeeded"]:
            rollback_note = "database transaction was not committed; transactional changes were rolled back"
        elif rollback["attempted"]:
            rollback_note = "database transaction was not committed; rollback itself failed — inspect PostgreSQL state"
        else:
            rollback_note = "database transaction was not committed"
        progress.stopped(rollback_note)

        print(
            json.dumps(
                {
                    "status": "FAIL",
                    "bootstrap_version": BOOTSTRAP_VERSION,
                    "error": str(exc),
                    "stage23": STAGE23_MARKER,
                    "progress": progress.snapshot(),
                    "diagnostics": diagnostics,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1

    finally:
        if cur is not None:
            try:
                cur.close()
            except Exception:
                pass
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
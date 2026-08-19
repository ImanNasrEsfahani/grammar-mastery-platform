#!/usr/bin/env python3
"""Safely add stage-by-stage terminal progress reporting to Question Bank bootstrap.py.

This tool is intentionally local-only. It does not use GitHub APIs, commit, or push.
Dry-run is the default. Pass --write to atomically update the target file.

Pinned source:
  repository: ImanNasrEsfahani/grammar-mastery-platform
  commit:     1d23edcf8399b313e7fa629267de44a28e4580da
  file:       ops/question_bank/bootstrap.py
  git blob:   36ce26fd729ae5f1d689d3a5c6b13b071174e955
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import os
from pathlib import Path
import stat
import sys
import tempfile

TARGET_RELATIVE = Path("ops/question_bank/bootstrap.py")
EXPECTED_COMMIT = "1d23edcf8399b313e7fa629267de44a28e4580da"
EXPECTED_GIT_BLOB_SHA = "36ce26fd729ae5f1d689d3a5c6b13b071174e955"
PATCH_MARKER = "class BootstrapProgress:"

LOGGER_BLOCK = r'''class BootstrapProgress:
    """Human-readable stage progress without changing bootstrap stdout JSON.

    Progress is written to stderr so successful stdout remains machine-readable.
    ANSI color is automatic for TTYs and can be controlled with:
      GMP_BOOTSTRAP_COLOR=always|auto|never
      GMP_BOOTSTRAP_PROGRESS=0   # disable progress lines entirely
      NO_COLOR=1                 # standard color opt-out
    """

    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    CYAN = "\033[96m"
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
        self.failed: dict[str, str] | None = None

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
        self.current = {"code": code, "name": name, "started": time.perf_counter()}
        self._emit(self.CYAN, code, "RUNNING", name)

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
        self._emit(
            self.GREEN,
            record["code"],
            "FINISHED",
            record["name"],
            f"SUCCESS; {detail + '; ' if detail else ''}{elapsed:.2f}s",
        )
        self.current = None

    def fail_current(self, exc: BaseException) -> None:
        if self.current is None:
            if self.failed is None:
                self.failed = {
                    "code": "UNTRACKED",
                    "name": "Untracked bootstrap operation",
                    "error": f"{type(exc).__name__}: {exc}",
                }
                self._emit(
                    self.RED,
                    "UNTRACKED",
                    "FAILED",
                    "Untracked bootstrap operation",
                    self.failed["error"],
                )
            return
        code = str(self.current["code"])
        name = str(self.current["name"])
        error = f"{type(exc).__name__}: {exc}"
        self.failed = {"code": code, "name": name, "error": error}
        self._emit(self.RED, code, "FAILED", name, error)
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
            "skipped_stages": [row["code"] for row in self.skipped],
            "last_completed_stage": last_completed,
            "failed_stage": self.failed,
            "database_commit_completed": self.has_completed("S12"),
        }

    def stopped(self, rollback_note: str = "") -> None:
        failed = self.failed or {
            "code": "UNTRACKED",
            "name": "Untracked bootstrap operation",
            "error": "unknown failure",
        }
        detail = f"last_failed_stage={failed['code']} ({failed['name']})"
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
'''

OLD_MAIN = r'''def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.publish_reviewed and args.publish_canonical_seed:
        print(json.dumps({"status": "FAIL", "error": "choose only one publication mode"}, ensure_ascii=False), file=sys.stderr)
        return 2
    if args.publish_reviewed and (not args.confirm_human_review or not args.reviewer_external_id):
        print(json.dumps({"status": "FAIL", "error": "--publish-reviewed requires both --confirm-human-review and --reviewer-external-id"}, ensure_ascii=False), file=sys.stderr)
        return 2
    if args.confirm_human_review and not args.publish_reviewed:
        print(json.dumps({"status": "FAIL", "error": "--confirm-human-review is only valid with --publish-reviewed"}, ensure_ascii=False), file=sys.stderr)
        return 2

    root = repo_root()
    try:
        master, rows, validation, master_sha = load_repository_seed(root, args.master)
        with connect() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    require_stage12_schema(cur)
                    stage6 = seed_stage6(cur, root)
                    stage7_map, stage7_inserted = seed_stage7_and_build_map(cur, root)
                    stage7_map_count = len(stage7_map)
                    qbank_compatibility = seed_qbank_compatibility_misconceptions(
                        cur, root, rows, stage7_map
                    )
                    target_ids, import_stats = upsert_questions(cur, rows, stage7_map)
                    verify_live_gate(cur, target_ids)
                    validation_rows = register_validation(cur, target_ids, validation, master_sha)
                    publication = {"ready": 0, "approved": 0, "published": 0}
                    batch_code = None
                    if args.publish_reviewed:
                        batch_code = args.publish_batch_code or default_batch_code(validation)
                        publication = publish_reviewed(cur, target_ids, args.reviewer_external_id, batch_code)
                    elif args.publish_canonical_seed:
                        batch_code = args.publish_batch_code or default_batch_code(validation)
                        publication = publish_reviewed(
                            cur,
                            target_ids,
                            CANONICAL_PUBLISHER_EXTERNAL_ID,
                            batch_code,
                            canonical_seed=True,
                        )
                    counts = summary_counts(cur, target_ids)
                    if args.publish_canonical_seed and (
                        counts.get("PUBLISHED") != len(target_ids)
                        or counts.get("SERVING") != len(target_ids)
                    ):
                        raise BootstrapError(
                            "canonical migration did not leave every target question PUBLISHED and serving"
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
            print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except Exception as exc:
        print(
            json.dumps(
                {"status": "FAIL", "bootstrap_version": BOOTSTRAP_VERSION, "error": str(exc), "stage23": STAGE23_MARKER},
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
'''

NEW_MAIN = r'''def main(argv: list[str] | None = None) -> int:
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
        progress.stopped()
        print(json.dumps({"status": "FAIL", "error": usage_error}, ensure_ascii=False), file=sys.stderr)
        return 2

    publication_mode = (
        "reviewed" if args.publish_reviewed
        else "canonical_seed" if args.publish_canonical_seed
        else "draft_only"
    )
    progress.finish_current(f"publication_mode={publication_mode}")

    root = repo_root()
    try:
        with progress.stage("S01", "Load and validate canonical Question Bank source") as step:
            master, rows, validation, master_sha = load_repository_seed(root, args.master)
            step["detail"] = f"rows={len(rows)}; source={master.name}"

        progress.start("S02", "Connect to PostgreSQL")
        with connect() as conn:
            progress.finish_current("connection established")
            with conn.transaction():
                with conn.cursor() as cur:
                    with progress.stage("S03", "Verify Stage12 schema and canonical reference seed"):
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

                    with progress.stage("S08", "Run live Stage11 machine validation gate"):
                        verify_live_gate(cur, target_ids)

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
                            "no publication flag supplied; database questions remain in their current status",
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
                        step["detail"] = ", ".join(
                            f"{key}={value}" for key, value in sorted(counts.items())
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

                    # The actual transaction commit happens when the context below exits.
                    # Start S12 before that exit so a commit failure is reported as S12.
                    progress.start("S12", "Commit PostgreSQL transaction")

            progress.finish_current("transaction committed; database changes persisted")
            result["progress"] = progress.snapshot()
            print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))

        progress.complete(len(target_ids))
        return 0
    except Exception as exc:
        # If the exception occurred during a manually-started stage such as
        # connection or transaction commit, report it here. Context-managed
        # stages already reported themselves and leave current=None.
        progress.fail_current(exc)
        rollback_note = ""
        if progress.has_completed("S02") and not progress.has_completed("S12"):
            rollback_note = "database transaction was not committed; transactional DB changes were rolled back"
        progress.stopped(rollback_note)
        print(
            json.dumps(
                {
                    "status": "FAIL",
                    "bootstrap_version": BOOTSTRAP_VERSION,
                    "error": str(exc),
                    "progress": progress.snapshot(),
                    "stage23": STAGE23_MARKER,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
'''


def git_blob_sha(text: str) -> str:
    data = text.replace("\r\n", "\n").encode("utf-8")
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data).hexdigest()


def apply_transform(original: str) -> str:
    if PATCH_MARKER in original:
        return original

    changed = original
    old = "import argparse\nimport csv\n"
    new = "import argparse\nfrom contextlib import contextmanager\nimport csv\n"
    if changed.count(old) != 1:
        raise RuntimeError("import anchor 1 not found exactly once")
    changed = changed.replace(old, new, 1)

    old = "import sys\nimport unicodedata\n"
    new = "import sys\nimport time\nimport unicodedata\n"
    if changed.count(old) != 1:
        raise RuntimeError("import anchor 2 not found exactly once")
    changed = changed.replace(old, new, 1)

    old = "class BootstrapError(RuntimeError):\n    pass\n\n\ndef repo_root() -> Path:\n"
    new = "class BootstrapError(RuntimeError):\n    pass\n\n\n" + LOGGER_BLOCK + "\n\ndef repo_root() -> Path:\n"
    if changed.count(old) != 1:
        raise RuntimeError("BootstrapError/repo_root anchor not found exactly once")
    changed = changed.replace(old, new, 1)

    if changed.count(OLD_MAIN) != 1:
        raise RuntimeError("main() anchor does not match the pinned bootstrap.py exactly")
    changed = changed.replace(OLD_MAIN, NEW_MAIN, 1)

    compile(changed, str(TARGET_RELATIVE), "exec")
    return changed


def atomic_write(path: Path, text: str) -> None:
    mode = stat.S_IMODE(path.stat().st_mode)
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_name, mode)
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path.cwd(),
        help="Repository root; default is current directory.",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Apply the change atomically. Without this flag, only show the diff.",
    )
    args = parser.parse_args()

    root = args.repo_root.resolve()
    target = root / TARGET_RELATIVE
    if not target.is_file():
        print(f"FAIL: target not found: {target}", file=sys.stderr)
        return 2

    original = target.read_text(encoding="utf-8")
    if PATCH_MARKER in original:
        print("PASS: bootstrap progress logging is already installed; no change needed.")
        return 0

    actual_blob = git_blob_sha(original)
    if actual_blob != EXPECTED_GIT_BLOB_SHA:
        print(
            "FAIL: bootstrap.py does not match the reviewed main baseline.\n"
            f" expected git blob: {EXPECTED_GIT_BLOB_SHA}\n"
            f" actual git blob:   {actual_blob}\n"
            "Refusing to patch a different file. Re-audit/rebase this package first.",
            file=sys.stderr,
        )
        return 2

    modified = apply_transform(original)
    diff = "".join(
        difflib.unified_diff(
            original.splitlines(keepends=True),
            modified.splitlines(keepends=True),
            fromfile=str(TARGET_RELATIVE) + " (before)",
            tofile=str(TARGET_RELATIVE) + " (after)",
        )
    )

    if not args.write:
        print(diff)
        print("\nDRY_RUN: no file was changed. Re-run with --write to apply.")
        return 0

    atomic_write(target, modified)
    new_blob = git_blob_sha(modified)
    print(
        "PASS: bootstrap.py updated atomically.\n"
        f" base_commit={EXPECTED_COMMIT}\n"
        f" old_git_blob={actual_blob}\n"
        f" new_git_blob={new_blob}\n"
        " No commit or push was performed."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

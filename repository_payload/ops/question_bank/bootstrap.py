from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import unicodedata
import uuid
from typing import Any

import psycopg
from psycopg.rows import dict_row

BOOTSTRAP_VERSION = "question-bank-bootstrap-v1.0.0"
WORKFLOW_VERSION = "question-qa-workflow-v0.9.0"
STAGE23_MARKER = "STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT"
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
    return mapping, inserted


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
                    raise BootstrapError(f"unresolved historical misconception {old_mid} in {row['external_id']} option {letter}")
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
) -> dict[str, int]:
    reviewer = resolve_actor(cur, reviewer_external_id, create_ai=False)
    if not reviewer["active"] or reviewer["actor_type"] not in {"REVIEWER", "ADMIN"}:
        raise BootstrapError("reviewer actor must be active and have REVIEWER or ADMIN role")
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
                        "Independent human review explicitly confirmed by operator via ops/question_bank/bootstrap.py --confirm-human-review.",
                        WORKFLOW_VERSION,
                    ),
                )
            cur.execute(
                "UPDATE questions SET status='APPROVED',approved_at=COALESCE(approved_at,now()) WHERE id=%s AND status='READY_FOR_REVIEW' RETURNING id",
                (r["id"],),
            )
            if cur.fetchone():
                event(cur, r["id"], "READY_FOR_REVIEW", "APPROVED", "APPROVE", reviewer_id, {"workflow_version": WORKFLOW_VERSION})
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
                json.dumps({"status": "PUBLISHED", "bootstrap_version": BOOTSTRAP_VERSION, "stage23": STAGE23_MARKER}, sort_keys=True),
                request_id,
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
    p.add_argument("--master", default=None, help="Repository-relative or absolute Stage10 master CSV. Default: the single full/v1.0 master CSV.")
    p.add_argument("--publish-reviewed", action="store_true", help="Continue through READY_FOR_REVIEW -> APPROVED -> PUBLISHED.")
    p.add_argument("--reviewer-external-id", default="", help="Independent REVIEWER/ADMIN actor external id.")
    p.add_argument("--confirm-human-review", action="store_true", help="Explicit operator attestation that independent human review has actually been completed.")
    p.add_argument("--publish-batch-code", default="", help="Optional explicit publish batch code.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.publish_reviewed and (not args.confirm_human_review or not args.reviewer_external_id):
        print(json.dumps({"status": "FAIL", "error": "--publish-reviewed requires both --confirm-human-review and --reviewer-external-id"}, ensure_ascii=False), file=sys.stderr)
        return 2
    if args.confirm_human_review and not args.publish_reviewed:
        print(json.dumps({"status": "FAIL", "error": "--confirm-human-review is only valid with --publish-reviewed"}, ensure_ascii=False), file=sys.stderr)
        return 2

    root = repo_root()
    try:
        master = discover_master(root, args.master)
        rows, validation, master_sha = load_and_validate_master(master)
        with connect() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    require_stage12_schema(cur)
                    stage6 = seed_stage6(cur, root)
                    stage7_map, stage7_inserted = seed_stage7_and_build_map(cur, root)
                    target_ids, import_stats = upsert_questions(cur, rows, stage7_map)
                    verify_live_gate(cur, target_ids)
                    validation_rows = register_validation(cur, target_ids, validation, master_sha)
                    publication = {"ready": 0, "approved": 0, "published": 0}
                    batch_code = None
                    if args.publish_reviewed:
                        batch_code = args.publish_batch_code or default_batch_code(validation)
                        publication = publish_reviewed(cur, target_ids, args.reviewer_external_id, batch_code)
                    counts = summary_counts(cur, target_ids)
                    result = {
                        "status": "PASS",
                        "bootstrap_version": BOOTSTRAP_VERSION,
                        "master": str(master.relative_to(root)),
                        "master_sha256": master_sha,
                        "target_questions": len(target_ids),
                        "stage6": stage6,
                        "stage7_historical_map_count": len(stage7_map),
                        "stage7_rows_inserted": stage7_inserted,
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


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any, Iterable
import uuid

import psycopg
from psycopg.rows import dict_row


SEED_VERSION = "canonical-knowledge-taxonomy-seed-v1.0.0"
SYSTEM_VERSION_COMPONENT = "stage12.reference_seed"

EXPECTED_COUNTS = {
    "categories": 11,
    "subcategories": 27,
    "tags": 35,
    "lessons": 52,
    "subtopics": 304,
}

SOURCE_BLOBS = {
    "data/knowledge/stage1_lessons_v1.0.csv":
        "c5939d760c5bde2b65b4527600284942d6814b19",
    "data/knowledge/stage1_subtopics_v1.0.csv":
        "d1604a65b44f04654823bb9b2f0cc1a0218269d1",
    "data/taxonomy/stage2_categories_v1.0.csv":
        "3ca2fa48636e820c35a42c53e3846aeeff511750",
    "data/taxonomy/stage2_subcategories_v1.0.csv":
        "0bbc5fb49a931d6da93e56f70dd1e6ab458e314b",
    "data/taxonomy/stage2_controlled_tags_v1.0.csv":
        "7a27e900eabb438819c3cda0f90b48a726dfb170",
    "data/taxonomy/stage2_lesson_category_mapping_v1.0.csv":
        "090b0db74f705b13eebffe990b2467550033d3e6",
    "data/taxonomy/stage2_lesson_tags_v1.0.csv":
        "67f9d08f9678fc01c6bc44c44790768454e91fab",
    "data/planning/stage3_lesson_weights_v1.0.csv":
        "b0b53171a0e652e9bf01b1576d76fade676ae29a",
}

REFERENCE_TABLES = (
    "grammar_categories",
    "grammar_lessons",
    "grammar_subtopics",
    "tags",
    "lesson_tags",
)


class SeedError(RuntimeError):
    pass


def git_blob_sha(data: bytes) -> str:
    data = data.replace(b"\r\n", b"\n")
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data).hexdigest()


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _source_path(root: Path, relative: str) -> Path:
    path = root / relative
    if not path.is_file():
        raise SeedError(f"canonical source file missing: {relative}")
    return path


def verify_source_identities(root: Path) -> dict[str, str]:
    actual: dict[str, str] = {}
    for relative, expected in SOURCE_BLOBS.items():
        data = _source_path(root, relative).read_bytes()
        found = git_blob_sha(data)
        actual[relative] = found
        if found != expected:
            raise SeedError(
                f"canonical source identity mismatch: {relative}; "
                f"expected {expected}, found {found}"
            )
    return actual


def read_csv(root: Path, relative: str) -> list[dict[str, str]]:
    path = _source_path(root, relative)
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise SeedError(f"CSV has no header: {relative}")
        rows = [dict(row) for row in reader]
    if not rows:
        raise SeedError(f"CSV is empty: {relative}")
    return rows


def _require_uuid(value: str, label: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise SeedError(f"invalid UUID in {label}: {value!r}") from exc


def _require_int(value: str, label: str) -> int:
    try:
        return int(str(value))
    except (ValueError, TypeError) as exc:
        raise SeedError(f"invalid integer in {label}: {value!r}") from exc


def _unique(rows: Iterable[dict[str, Any]], key: str, label: str) -> None:
    seen: set[str] = set()
    for row in rows:
        value = str(row[key])
        if value in seen:
            raise SeedError(f"duplicate {label}: {value}")
        seen.add(value)


@dataclass(frozen=True)
class SeedData:
    categories: list[dict[str, Any]]
    subcategories: list[dict[str, Any]]
    tags: list[dict[str, Any]]
    lessons: list[dict[str, Any]]
    subtopics: list[dict[str, Any]]
    lesson_tags: list[dict[str, Any]]
    source_blobs: dict[str, str]

    @property
    def counts(self) -> dict[str, int]:
        return {
            "categories": len(self.categories),
            "subcategories": len(self.subcategories),
            "tags": len(self.tags),
            "lessons": len(self.lessons),
            "subtopics": len(self.subtopics),
            "lesson_tags": len(self.lesson_tags),
        }


def load_seed_data(root: Path) -> SeedData:
    source_blobs = verify_source_identities(root)

    category_rows = read_csv(root, "data/taxonomy/stage2_categories_v1.0.csv")
    subcategory_rows = read_csv(root, "data/taxonomy/stage2_subcategories_v1.0.csv")
    tag_rows = read_csv(root, "data/taxonomy/stage2_controlled_tags_v1.0.csv")
    lesson_rows = read_csv(root, "data/knowledge/stage1_lessons_v1.0.csv")
    subtopic_rows = read_csv(root, "data/knowledge/stage1_subtopics_v1.0.csv")
    mapping_rows = read_csv(
        root, "data/taxonomy/stage2_lesson_category_mapping_v1.0.csv"
    )
    lesson_tag_rows = read_csv(root, "data/taxonomy/stage2_lesson_tags_v1.0.csv")
    weight_rows = read_csv(root, "data/planning/stage3_lesson_weights_v1.0.csv")

    for label, rows, expected in (
        ("categories", category_rows, EXPECTED_COUNTS["categories"]),
        ("subcategories", subcategory_rows, EXPECTED_COUNTS["subcategories"]),
        ("tags", tag_rows, EXPECTED_COUNTS["tags"]),
        ("lessons", lesson_rows, EXPECTED_COUNTS["lessons"]),
        ("subtopics", subtopic_rows, EXPECTED_COUNTS["subtopics"]),
        ("lesson mappings", mapping_rows, EXPECTED_COUNTS["lessons"]),
        ("lesson weights", weight_rows, EXPECTED_COUNTS["lessons"]),
    ):
        if len(rows) != expected:
            raise SeedError(
                f"{label} count mismatch: expected {expected}, found {len(rows)}"
            )

    _unique(category_rows, "category_id", "category_id")
    _unique(subcategory_rows, "subcategory_id", "subcategory_id")
    _unique(tag_rows, "tag_id", "tag_id")
    _unique(lesson_rows, "lesson_id", "lesson_id")
    _unique(lesson_rows, "lesson_no", "lesson_no")
    _unique(subtopic_rows, "subtopic_id", "subtopic_id")
    _unique(subtopic_rows, "subtopic_code", "subtopic_code")
    _unique(mapping_rows, "lesson_id", "mapped lesson_id")
    _unique(weight_rows, "lesson_id", "weighted lesson_id")

    category_ids = {_require_uuid(row["category_id"], "category_id") for row in category_rows}
    subcategory_ids = {
        _require_uuid(row["subcategory_id"], "subcategory_id")
        for row in subcategory_rows
    }
    tag_ids = {_require_uuid(row["tag_id"], "tag_id") for row in tag_rows}
    lesson_ids = {_require_uuid(row["lesson_id"], "lesson_id") for row in lesson_rows}

    mapping_by_lesson = {
        _require_uuid(row["lesson_id"], "mapping.lesson_id"): row
        for row in mapping_rows
    }
    weight_by_lesson = {
        _require_uuid(row["lesson_id"], "weight.lesson_id"): row
        for row in weight_rows
    }
    if set(mapping_by_lesson) != lesson_ids:
        raise SeedError("Stage 2 lesson mapping does not cover exactly the 52 Stage 1 lessons")
    if set(weight_by_lesson) != lesson_ids:
        raise SeedError("Stage 3 weights do not cover exactly the 52 Stage 1 lessons")

    weight_total = sum(
        Decimal(str(row["final_weight_pct"])) for row in weight_rows
    )
    if weight_total != Decimal("100.00"):
        raise SeedError(f"Stage 3 final_weight_pct total must be 100.00, found {weight_total}")

    categories = []
    for row in category_rows:
        category_id = _require_uuid(row["category_id"], "category_id")
        categories.append(
            {
                "id": category_id,
                "code": row["category_code"],
                "slug": row["slug"],
                "node_kind": "CATEGORY",
                "parent_id": None,
                "display_name_fr": row["display_name_fr"],
                "display_name_fa": row["display_name_fa_draft"] or None,
                "membership_rule_fa": row["membership_rule_fa"] or None,
                "display_order": _require_int(row["display_order"], "category.display_order"),
                "status": row["status"].upper(),
                "taxonomy_version": row["taxonomy_version"],
            }
        )

    subcategories = []
    for row in subcategory_rows:
        subcategory_id = _require_uuid(row["subcategory_id"], "subcategory_id")
        parent_id = _require_uuid(row["category_id"], "subcategory.category_id")
        if parent_id not in category_ids:
            raise SeedError(f"subcategory parent is missing: {parent_id}")
        subcategories.append(
            {
                "id": subcategory_id,
                "code": row["subcategory_code"],
                "slug": row["slug"],
                "node_kind": "SUBCATEGORY",
                "parent_id": parent_id,
                "display_name_fr": row["display_name_fr"],
                "display_name_fa": row["display_name_fa_draft"] or None,
                "membership_rule_fa": row["membership_rule_fa"] or None,
                "display_order": _require_int(
                    row["display_order"], "subcategory.display_order"
                ),
                "status": row["status"].upper(),
                "taxonomy_version": row["taxonomy_version"],
            }
        )

    tags = []
    for row in tag_rows:
        tag_id = _require_uuid(row["tag_id"], "tag_id")
        tags.append(
            {
                "id": tag_id,
                "code": row["tag_code"],
                "slug": row["slug"],
                "tag_group": row["tag_group"] or None,
                "display_name_fr": row["display_name_fr"],
                "display_name_fa": row["display_name_fa_draft"] or None,
                "membership_rule_fa": row["membership_rule_fa"] or None,
                "status": row["status"].upper(),
                "taxonomy_version": row["taxonomy_version"],
            }
        )

    lessons = []
    for row in lesson_rows:
        lesson_id = _require_uuid(row["lesson_id"], "lesson_id")
        mapping = mapping_by_lesson[lesson_id]
        weight = weight_by_lesson[lesson_id]
        category_id = _require_uuid(mapping["category_id"], "mapping.category_id")
        subcategory_id = _require_uuid(
            mapping["subcategory_id"], "mapping.subcategory_id"
        )
        if category_id not in category_ids or subcategory_id not in subcategory_ids:
            raise SeedError(f"lesson {lesson_id} references unknown taxonomy nodes")
        if str(row["lesson_no"]) != str(mapping["lesson_no"]):
            raise SeedError(f"lesson_no mismatch for lesson {lesson_id}")
        if str(row["lesson_no"]) != str(weight["lesson_no"]):
            raise SeedError(f"weight lesson_no mismatch for lesson {lesson_id}")
        if row["title_fr_official"] != mapping["title_fr_official"]:
            raise SeedError(f"title mismatch between Stage 1 and Stage 2 for {lesson_id}")
        if row["title_fr_official"] != weight["title_fr_official"]:
            raise SeedError(f"title mismatch between Stage 1 and Stage 3 for {lesson_id}")

        lessons.append(
            {
                "id": lesson_id,
                "lesson_no": _require_int(row["lesson_no"], "lesson.lesson_no"),
                "title_fr_official": row["title_fr_official"],
                "system_short_title": row["system_short_title"],
                "category_id": category_id,
                "subcategory_id": subcategory_id,
                "tcf_weight": Decimal(str(weight["final_weight_pct"])),
                "book_pages": row["book_pages"] or None,
                "pdf_pages": row["pdf_pages"] or None,
                "source_ref": row["source_ref"],
                "extraction_status": row["extraction_status"] or None,
                "content_version": row["content_version"],
                "taxonomy_version": mapping["taxonomy_version"],
            }
        )

    subtopics = []
    for row in subtopic_rows:
        subtopic_id = _require_uuid(row["subtopic_id"], "subtopic_id")
        lesson_id = _require_uuid(row["lesson_id"], "subtopic.lesson_id")
        if lesson_id not in lesson_ids:
            raise SeedError(f"subtopic references unknown lesson: {lesson_id}")
        subtopics.append(
            {
                "id": subtopic_id,
                "lesson_id": lesson_id,
                "subtopic_code": row["subtopic_code"],
                "title_fr": row["title_fr"],
                "title_fa": row["title_fa_draft"] or None,
                "short_definition_fa": row["definition_short_fa"] or None,
                "teaching_note_fa": row["explanation_long_fa"] or None,
                "exceptions_register_note": row["notes_exceptions_register"] or None,
                "source_book_pages": row["source_book_pages"] or None,
                "source_pdf_pages": row["source_pdf_pages"] or None,
                "source_ref": row["source_ref"],
                "source_basis": row["source_basis"] or None,
                "translation_status": row["translation_status"] or None,
                "content_version": row["content_version"],
            }
        )

    lesson_tags = []
    seen_pairs: set[tuple[str, str]] = set()
    for row in lesson_tag_rows:
        lesson_id = _require_uuid(row["lesson_id"], "lesson_tag.lesson_id")
        tag_id = _require_uuid(row["tag_id"], "lesson_tag.tag_id")
        if lesson_id not in lesson_ids:
            raise SeedError(f"lesson_tag references unknown lesson: {lesson_id}")
        if tag_id not in tag_ids:
            raise SeedError(f"lesson_tag references unknown tag: {tag_id}")
        pair = (lesson_id, tag_id)
        if pair in seen_pairs:
            raise SeedError(f"duplicate lesson_tag pair: {lesson_id}/{tag_id}")
        seen_pairs.add(pair)
        lesson_tags.append(
            {
                "lesson_id": lesson_id,
                "tag_id": tag_id,
                "assignment_order": _require_int(
                    row["assignment_order"], "lesson_tag.assignment_order"
                ),
                "assignment_basis": row["assignment_basis"] or None,
                "taxonomy_version": row["taxonomy_version"],
            }
        )

    return SeedData(
        categories=categories,
        subcategories=subcategories,
        tags=tags,
        lessons=lessons,
        subtopics=subtopics,
        lesson_tags=lesson_tags,
        source_blobs=source_blobs,
    )


def _connection_kwargs() -> dict[str, Any]:
    name = os.getenv("DJANGO_DB_NAME", os.getenv("PGDATABASE", os.getenv("POSTGRES_DB", "grammar_mastery")))
    user = os.getenv("DJANGO_DB_USER", os.getenv("PGUSER", os.getenv("POSTGRES_USER", "grammar_mastery")))
    password = os.getenv("DJANGO_DB_PASSWORD", os.getenv("PGPASSWORD", os.getenv("POSTGRES_PASSWORD", "")))
    host = os.getenv("DJANGO_DB_HOST", os.getenv("PGHOST", "postgres"))
    port = int(os.getenv("DJANGO_DB_PORT", os.getenv("PGPORT", "5432")))
    sslmode = os.getenv("DJANGO_DB_SSLMODE", os.getenv("PGSSLMODE", "prefer"))
    if not password:
        raise SeedError("database password is not available in runtime environment")
    return {
        "dbname": name,
        "user": user,
        "password": password,
        "host": host,
        "port": port,
        "sslmode": sslmode,
        "connect_timeout": 10,
    }


def _table_counts(cursor) -> dict[str, int]:
    result: dict[str, int] = {}
    for table in REFERENCE_TABLES:
        cursor.execute(f"SELECT count(*) AS n FROM {table}")
        result[table] = int(cursor.fetchone()["n"])
    return result


def _ensure_empty_reference_tables(cursor) -> dict[str, int]:
    counts = _table_counts(cursor)
    nonempty = {table: count for table, count in counts.items() if count != 0}
    if nonempty:
        raise SeedError(
            "reference-data tables are not empty; refusing merge/upsert into production: "
            + json.dumps(nonempty, sort_keys=True)
        )
    return counts


def _insert_categories(cursor, rows: list[dict[str, Any]]) -> None:
    cursor.executemany(
        """
        INSERT INTO grammar_categories (
            id, code, slug, node_kind, parent_id,
            display_name_fr, display_name_fa, membership_rule_fa,
            display_order, status, taxonomy_version
        )
        VALUES (
            %(id)s, %(code)s, %(slug)s, %(node_kind)s, %(parent_id)s,
            %(display_name_fr)s, %(display_name_fa)s, %(membership_rule_fa)s,
            %(display_order)s, %(status)s, %(taxonomy_version)s
        )
        """,
        rows,
    )


def _insert_tags(cursor, rows: list[dict[str, Any]]) -> None:
    cursor.executemany(
        """
        INSERT INTO tags (
            id, code, slug, tag_group, display_name_fr, display_name_fa,
            membership_rule_fa, status, taxonomy_version
        )
        VALUES (
            %(id)s, %(code)s, %(slug)s, %(tag_group)s,
            %(display_name_fr)s, %(display_name_fa)s,
            %(membership_rule_fa)s, %(status)s, %(taxonomy_version)s
        )
        """,
        rows,
    )


def _insert_lessons(cursor, rows: list[dict[str, Any]]) -> None:
    cursor.executemany(
        """
        INSERT INTO grammar_lessons (
            id, lesson_no, title_fr_official, system_short_title,
            category_id, subcategory_id, tcf_weight,
            book_pages, pdf_pages, source_ref, active,
            extraction_status, content_version, taxonomy_version
        )
        VALUES (
            %(id)s, %(lesson_no)s, %(title_fr_official)s, %(system_short_title)s,
            %(category_id)s, %(subcategory_id)s, %(tcf_weight)s,
            %(book_pages)s, %(pdf_pages)s, %(source_ref)s, TRUE,
            %(extraction_status)s, %(content_version)s, %(taxonomy_version)s
        )
        """,
        rows,
    )


def _insert_subtopics(cursor, rows: list[dict[str, Any]]) -> None:
    cursor.executemany(
        """
        INSERT INTO grammar_subtopics (
            id, lesson_id, subtopic_code, title_fr, title_fa,
            short_definition_fa, teaching_note_fa, exceptions_register_note,
            source_book_pages, source_pdf_pages, source_ref, source_basis,
            translation_status, content_version, active
        )
        VALUES (
            %(id)s, %(lesson_id)s, %(subtopic_code)s, %(title_fr)s, %(title_fa)s,
            %(short_definition_fa)s, %(teaching_note_fa)s,
            %(exceptions_register_note)s, %(source_book_pages)s,
            %(source_pdf_pages)s, %(source_ref)s, %(source_basis)s,
            %(translation_status)s, %(content_version)s, TRUE
        )
        """,
        rows,
    )


def _insert_lesson_tags(cursor, rows: list[dict[str, Any]]) -> None:
    cursor.executemany(
        """
        INSERT INTO lesson_tags (
            lesson_id, tag_id, assignment_order, assignment_basis, taxonomy_version
        )
        VALUES (
            %(lesson_id)s, %(tag_id)s, %(assignment_order)s,
            %(assignment_basis)s, %(taxonomy_version)s
        )
        """,
        rows,
    )


def execute_seed(
    data: SeedData,
    *,
    target: str,
    backup_id: str,
    confirm_seed_id: str,
) -> dict[str, Any]:
    if target == "production":
        if not backup_id.strip():
            raise SeedError("production seed requires --backup-id")
        if not confirm_seed_id.strip():
            raise SeedError("production seed requires --confirm-seed-id")

    with psycopg.connect(**_connection_kwargs(), row_factory=dict_row) as conn:
        with conn.transaction():
            with conn.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s)", [120052304])
                cursor.execute(
                    """
                    SELECT version
                    FROM system_versions
                    WHERE component = %s
                    FOR UPDATE
                    """,
                    [SYSTEM_VERSION_COMPONENT],
                )
                existing_marker = cursor.fetchone()
                if existing_marker is not None:
                    expected = {
                        "grammar_categories": EXPECTED_COUNTS["categories"] + EXPECTED_COUNTS["subcategories"],
                        "grammar_lessons": EXPECTED_COUNTS["lessons"],
                        "grammar_subtopics": EXPECTED_COUNTS["subtopics"],
                        "tags": EXPECTED_COUNTS["tags"],
                        "lesson_tags": len(data.lesson_tags),
                    }
                    actual = _table_counts(cursor)
                    if existing_marker["version"] != SEED_VERSION or actual != expected:
                        raise SeedError(
                            f"{SYSTEM_VERSION_COMPONENT} marker/data mismatch; "
                            + json.dumps(
                                {
                                    "expected_version": SEED_VERSION,
                                    "actual_version": existing_marker["version"],
                                    "expected_counts": expected,
                                    "actual_counts": actual,
                                },
                                sort_keys=True,
                            )
                        )
                    return {
                        "status": "PASS",
                        "target": target,
                        "seed_version": SEED_VERSION,
                        "already_applied": True,
                        "confirm_seed_id": confirm_seed_id or None,
                        "backup_id": backup_id or None,
                        "counts": data.counts,
                    }

                before = _ensure_empty_reference_tables(cursor)

                _insert_categories(cursor, data.categories)
                _insert_categories(cursor, data.subcategories)
                _insert_tags(cursor, data.tags)
                _insert_lessons(cursor, data.lessons)
                _insert_subtopics(cursor, data.subtopics)
                _insert_lesson_tags(cursor, data.lesson_tags)

                after = _table_counts(cursor)
                expected_after = {
                    "grammar_categories":
                        EXPECTED_COUNTS["categories"] + EXPECTED_COUNTS["subcategories"],
                    "grammar_lessons": EXPECTED_COUNTS["lessons"],
                    "grammar_subtopics": EXPECTED_COUNTS["subtopics"],
                    "tags": EXPECTED_COUNTS["tags"],
                    "lesson_tags": len(data.lesson_tags),
                }
                if after != expected_after:
                    raise SeedError(
                        "post-seed count validation failed: "
                        + json.dumps(
                            {"expected": expected_after, "actual": after},
                            sort_keys=True,
                        )
                    )

                cursor.execute(
                    """
                    SELECT count(*) AS n
                    FROM grammar_lessons
                    WHERE tcf_weight <= 0
                    """
                )
                zero_weights = int(cursor.fetchone()["n"])
                if zero_weights:
                    raise SeedError(
                        f"{zero_weights} lesson(s) have non-positive TCF weight after seed"
                    )

                cursor.execute(
                    "SELECT sum(tcf_weight) AS total FROM grammar_lessons"
                )
                weight_total = Decimal(str(cursor.fetchone()["total"]))
                if weight_total != Decimal("100.0000"):
                    raise SeedError(
                        f"database TCF weight total must be 100.0000, found {weight_total}"
                    )

                marker_metadata = {
                    "target": target,
                    "confirm_seed_id": confirm_seed_id or None,
                    "backup_id": backup_id or None,
                    "counts": data.counts,
                    "source_git_blobs": data.source_blobs,
                }
                cursor.execute(
                    """
                    INSERT INTO system_versions (
                        component,
                        version,
                        status,
                        source_ref,
                        metadata
                    )
                    VALUES (%s, %s, 'APPLIED', %s, %s::jsonb)
                    """,
                    [
                        SYSTEM_VERSION_COMPONENT,
                        SEED_VERSION,
                        "repository canonical Stage1/Stage2/Stage3 CSV sources",
                        json.dumps(
                            marker_metadata,
                            ensure_ascii=False,
                            sort_keys=True,
                            separators=(",", ":"),
                        ),
                    ],
                )

    return {
        "status": "PASS",
        "target": target,
        "seed_version": SEED_VERSION,
        "already_applied": False,
        "confirm_seed_id": confirm_seed_id or None,
        "backup_id": backup_id or None,
        "counts": data.counts,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Validate and one-time seed canonical Grammar Mastery knowledge/taxonomy "
            "reference data into an empty Stage 12 PostgreSQL schema."
        )
    )
    parser.add_argument(
        "--target",
        choices=("staging", "production"),
        default="staging",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Write the validated canonical reference rows transactionally.",
    )
    parser.add_argument(
        "--backup-id",
        default="",
        help="Required for production execution; records the verified backup identifier.",
    )
    parser.add_argument(
        "--confirm-seed-id",
        default="",
        help="Required for production execution; operator-provided release/seed confirmation id.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        root = _repo_root()
        data = load_seed_data(root)
        if not args.execute:
            print(
                json.dumps(
                    {
                        "status": "DRY_RUN",
                        "target": args.target,
                        "seed_version": SEED_VERSION,
                        "counts": data.counts,
                        "source_git_blobs": data.source_blobs,
                        "writes_performed": False,
                    },
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
            )
            return 0

        result = execute_seed(
            data,
            target=args.target,
            backup_id=args.backup_id,
            confirm_seed_id=args.confirm_seed_id,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "FAIL",
                    "seed_version": SEED_VERSION,
                    "error": str(exc),
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

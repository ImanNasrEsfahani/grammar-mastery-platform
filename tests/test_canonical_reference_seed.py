from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "ops/stage12/seed_canonical_reference.py"
SPEC = importlib.util.spec_from_file_location("canonical_reference_seed", MODULE_PATH)
seed = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(seed)


class CanonicalReferenceSeedTests(unittest.TestCase):
    def test_expected_canonical_counts_are_frozen(self):
        self.assertEqual(
            seed.EXPECTED_COUNTS,
            {
                "categories": 11,
                "subcategories": 27,
                "tags": 35,
                "lessons": 52,
                "subtopics": 304,
            },
        )

    def test_all_seed_sources_are_pinned_by_git_blob_identity(self):
        self.assertEqual(len(seed.SOURCE_BLOBS), 8)
        for path, blob in seed.SOURCE_BLOBS.items():
            self.assertTrue(path.startswith("data/"))
            self.assertEqual(len(blob), 40)
            int(blob, 16)

    def test_git_blob_hash_uses_real_nul_header(self):
        self.assertEqual(
            seed.git_blob_sha(b"test\n"),
            "9daeafb9864cf43055ae93beb0afd6c7d144bfa4",
        )

    def test_reference_seed_does_not_include_user_or_auth_tables(self):
        self.assertNotIn("users", seed.REFERENCE_TABLES)
        self.assertNotIn("user_credentials", seed.REFERENCE_TABLES)
        self.assertNotIn("auth_sessions", seed.REFERENCE_TABLES)

    def test_source_files_validate_when_present_in_repository(self):
        missing = [
            path
            for path in seed.SOURCE_BLOBS
            if not (ROOT / path).is_file()
        ]
        if missing:
            self.skipTest("canonical CSV sources are not part of this patch-only sandbox")
        data = seed.load_seed_data(ROOT)
        self.assertEqual(data.counts["lessons"], 52)
        self.assertEqual(data.counts["subtopics"], 304)
        self.assertEqual(data.counts["categories"], 11)
        self.assertEqual(data.counts["subcategories"], 27)
        self.assertEqual(data.counts["tags"], 35)
        self.assertGreater(data.counts["lesson_tags"], 0)


if __name__ == "__main__":
    unittest.main()

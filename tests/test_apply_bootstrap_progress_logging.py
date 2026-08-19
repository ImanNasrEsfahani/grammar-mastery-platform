from __future__ import annotations

import importlib.util
import io
import os
from pathlib import Path
import sys
import unittest

HERE = Path(__file__).resolve().parents[1]
PATCHER_PATH = HERE / "apply_bootstrap_progress_logging_v1_0.py"
SPEC = importlib.util.spec_from_file_location("bootstrap_progress_patcher", PATCHER_PATH)
patcher = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = patcher
SPEC.loader.exec_module(patcher)


FIXTURE_PREFIX = '''from __future__ import annotations

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

class BootstrapError(RuntimeError):
    pass


def repo_root() -> Path:
    return Path(".")


def build_parser():
    return argparse.ArgumentParser()

'''


class TTYBuffer(io.StringIO):
    def isatty(self) -> bool:
        return True


class BootstrapProgressPatchTests(unittest.TestCase):
    def transformed_namespace(self):
        original = FIXTURE_PREFIX + patcher.OLD_MAIN + "\n"
        modified = patcher.apply_transform(original)
        compile(modified, "bootstrap.py", "exec")
        ns: dict[str, object] = {}
        exec(compile(modified, "bootstrap.py", "exec"), ns, ns)
        return modified, ns

    def test_transform_adds_progress_and_is_idempotent(self):
        modified, _ = self.transformed_namespace()
        self.assertIn("class BootstrapProgress:", modified)
        self.assertIn('progress.start("S12", "Commit PostgreSQL transaction")', modified)
        self.assertEqual(modified, patcher.apply_transform(modified))

    def test_success_stage_is_green_and_finished(self):
        _, ns = self.transformed_namespace()
        cls = ns["BootstrapProgress"]
        buffer = TTYBuffer()
        old = os.environ.get("GMP_BOOTSTRAP_COLOR")
        os.environ["GMP_BOOTSTRAP_COLOR"] = "always"
        try:
            progress = cls(buffer)
            with progress.stage("S01", "Demo stage") as step:
                step["detail"] = "rows=10"
        finally:
            if old is None:
                os.environ.pop("GMP_BOOTSTRAP_COLOR", None)
            else:
                os.environ["GMP_BOOTSTRAP_COLOR"] = old
        output = buffer.getvalue()
        self.assertIn("\x1b[92m", output)
        self.assertIn("[S01][FINISHED]", output)
        self.assertIn("SUCCESS", output)
        self.assertIn("rows=10", output)

    def test_failure_stage_is_red_and_snapshot_names_failed_stage(self):
        _, ns = self.transformed_namespace()
        cls = ns["BootstrapProgress"]
        buffer = TTYBuffer()
        old = os.environ.get("GMP_BOOTSTRAP_COLOR")
        os.environ["GMP_BOOTSTRAP_COLOR"] = "always"
        try:
            progress = cls(buffer)
            with self.assertRaisesRegex(ValueError, "broken"):
                with progress.stage("S07", "Upsert questions"):
                    raise ValueError("broken")
            snapshot = progress.snapshot()
        finally:
            if old is None:
                os.environ.pop("GMP_BOOTSTRAP_COLOR", None)
            else:
                os.environ["GMP_BOOTSTRAP_COLOR"] = old
        output = buffer.getvalue()
        self.assertIn("\x1b[91m", output)
        self.assertIn("[S07][FAILED]", output)
        self.assertEqual("S07", snapshot["failed_stage"]["code"])
        self.assertEqual("Upsert questions", snapshot["failed_stage"]["name"])
        self.assertFalse(snapshot["database_commit_completed"])


if __name__ == "__main__":
    unittest.main()

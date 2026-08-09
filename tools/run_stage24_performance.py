from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

from stage24_performance_harness import run_reference_baseline


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Stage24 synthetic reference baseline.")
    parser.add_argument("--check", action="store_true", help="exit non-zero when a guardrail fails")
    parser.add_argument("--output", type=Path, help="optional JSON evidence output path")
    args = parser.parse_args()
    result = run_reference_baseline()
    rendered = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        target = args.output if args.output.is_absolute() else ROOT / args.output
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 1 if args.check and not result["overall_pass"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

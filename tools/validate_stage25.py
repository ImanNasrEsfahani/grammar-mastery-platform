from __future__ import annotations

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    contract = json.loads((ROOT / "config/stage25_security_contract_v1.0.json").read_text(encoding="utf-8"))
    assert contract["stage"] == 25 and contract["contract_version"] == "stage25-security-v1.0.0"
    assert set(contract["rate_limits"]) == {"login_per_ip", "login_per_account", "answer_per_user", "import_per_staff", "admin_write_per_staff"}
    with (ROOT / "docs/stages/stage25/rbac_matrix_v1.0.csv").open(encoding="utf-8", newline="") as stream:
        rbac = list(csv.DictReader(stream))
    assert rbac and all(row["audit_required"] == "yes" for row in rbac)
    with (ROOT / "docs/stages/stage25/threat_control_matrix_v1.0.csv").open(encoding="utf-8", newline="") as stream:
        threats = {row["threat"] for row in csv.DictReader(stream)}
    assert {"credential_stuffing", "answer_scraping", "admin_abuse", "data_loss", "secret_leak"} <= threats
    print("Stage 25 contract validation: PASS")


if __name__ == "__main__":
    main()

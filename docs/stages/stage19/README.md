# Stage 19 — Site pages and responsibilities

- **Prior package:** `stage19_ia_site_pages_v0.9.zip`
- **Prior reported validation:** `63 PASS / 0 FAIL / 0 WARN`

The earlier chat summary recovered the original package name, filenames, route counts and validation result, but the sandbox ZIP itself was not persisted in Library. The files in this repository reconstruct that contract and preserve the recovered invariants.

- `config/stage19_site_page_contract_v0.9.json`
- `data/product/stage19_route_map_v0.9.csv`
- `data/product/stage19_page_inventory_v0.9.csv`
- `data/product/stage19_navigation_matrix_v0.9.csv`
- `docs/stages/stage19/validation_v0.9.json`
- `docs/stages/stage19/review_report_v0.9.md`

Canonical web locales are `/en` and `/fa`. Translated labels never change the stable route slug.

The 26-row route map intentionally enumerates canonical page landing routes. The fourth parameterized template, `/:locale/review/:group_key`, is a supplemental deep link into the canonical `/:locale/review` responsibility and is therefore not counted as an additional landing route.

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {transformCss, walkCssFiles} from "./responsive-css-tools.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");
const sourceRoot = path.join(frontendRoot, "src");
const write = process.argv.includes("--write");
const skip = new Set([
  path.join(sourceRoot, "app", "responsive-foundation.css"),
  path.join(sourceRoot, "components", "navigation", "AppHeader.module.css"),
  path.join(sourceRoot, "components", "navigation", "MobileBottomNavigation.module.css"),
]);

const files = walkCssFiles(sourceRoot).filter((file) => !skip.has(file));
let changed = 0;
let declarationsBefore = 0;
let declarationsAfter = 0;

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  const after = transformCss(before);
  if (before !== after) {
    changed += 1;
    declarationsBefore += (before.match(/\b(?:left|right|top|bottom|width|height|min-width|max-width|min-height|max-height)\s*:/g) ?? []).length;
    declarationsAfter += (after.match(/\b(?:left|right|top|bottom|width|height|min-width|max-width|min-height|max-height)\s*:/g) ?? []).length;
    const rel = path.relative(frontendRoot, file).replaceAll(path.sep, "/");
    console.log(`${write ? "WRITE" : "WOULD WRITE"} ${rel}`);
    if (write) fs.writeFileSync(file, after, "utf8");
  }
}

console.log(`\nResponsive CSS refactor: ${changed}/${files.length} stylesheet(s) ${write ? "updated" : "would change"}.`);
if (!write) console.log("Dry run only. Re-run with --write to apply.");
else console.log(`Legacy physical declarations observed in changed files: ${declarationsBefore}; remaining raw physical declarations counted by this quick metric: ${declarationsAfter}.`);

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {auditCssText, walkCssFiles} from "./responsive-css-tools.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");
const files = walkCssFiles(path.join(frontendRoot, "src"));
const issues = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  issues.push(...auditCssText(text, path.relative(frontendRoot, file).replaceAll(path.sep, "/")));
}

if (issues.length) {
  console.error(`Responsive CSS audit failed with ${issues.length} issue(s):`);
  for (const issue of issues.slice(0, 120)) {
    console.error(`- ${issue.file}:${issue.line} [${issue.type}] ${issue.text}`);
  }
  if (issues.length > 120) console.error(`... ${issues.length - 120} more issue(s)`);
  process.exitCode = 1;
} else {
  console.log(`Responsive CSS audit passed across ${files.length} stylesheet(s).`);
  console.log("No physical directional properties, 100vw escapes, or non-allowlisted absolute/fixed/sticky structural positioning detected.");
}

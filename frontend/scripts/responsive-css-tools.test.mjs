import assert from "node:assert/strict";
import {auditCssText, transformCss} from "./responsive-css-tools.mjs";

const cases = [
  {
    name: "viewport escape and sticky rail",
    input: `.page { position: relative; left: 50%; width: min(1490px, calc(100vw - 18px)); min-height: calc(100vh - 72px); transform: translateX(-50%); }\n.rail { position: sticky; top: 82px; width: 220px; }`,
    mustContain: ["inset-inline-start: auto", "inline-size: min(1490px, 100%)", "position: static"],
  },
  {
    name: "RTL physical spacing",
    input: `.column { padding: 0 50px 0 10px; margin-left: 12px; text-align: right; font-size: 13px; }`,
    mustContain: ["padding-inline-end: 50px", "padding-inline-start: 10px", "margin-inline-start: 12px", "text-align: end", "--ui-font-adjust"],
  },
  {
    name: "locale shell direction inheritance",
    input: `.workspace { direction: ltr; display: grid; }\n.frenchText { direction: ltr; }`,
    mustContain: ["direction inherits from the locale shell", ".frenchText { direction: ltr;"],
  },
  {
    name: "true overlay positioning is retained logically",
    input: `.dialogBackdrop { position: fixed; inset: 0; width: 100vw; height: 100vh; }\n.cardMenu { position: absolute; right: 0; top: 100%; width: 150px; }`,
    mustContain: ["position: fixed", "inline-size: 100%", "block-size: 100vh", "inset-inline-end: 0", "inset-block-start: 100%"],
  },
  {
    name: "visually hidden native label remains out of flow",
    input: `.dateControl label span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }`,
    mustContain: ["position: absolute", "inline-size: 1px", "block-size: 1px"],
  },
];

for (const item of cases) {
  const transformed = transformCss(item.input);
  for (const expected of item.mustContain) {
    assert.ok(transformed.includes(expected), `${item.name}: missing ${expected}\n${transformed}`);
  }
  assert.deepEqual(auditCssText(transformed, item.name), [], `${item.name}: audit should pass`);
}

console.log(`Responsive CSS tool tests passed (${cases.length} cases).`);

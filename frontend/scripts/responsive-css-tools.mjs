import fs from "node:fs";
import path from "node:path";

export const POSITION_ALLOWLIST = /(?:dialog|modal|drawer|backdrop|overlay|popover|tooltip|menu|dropdown|toast|badge|dot|icon|toggle|chevron|arrow|eye|checkbox|radio|rememberChoice|artwork|ornament|decorat|marker|indicator|ring|donut|progress|chart|plot|axis|spark|track|fill|handle|thumb|line|avatar|floating|feedback|sheet|scrim|skeleton|spinner|srOnly|visually|hidden|notificationLabel|theme-toggle-label|label\s+span|screenReader|a11y|skip|searchIcon|moreWrap|cardMenu|pseudo|before|after)/i;
export const DIRECTION_ALLOWLIST = /(?:french|français|lessonTitle|question|stem|option|answer|code|request|email|date|score|tabular|number|numeric|kbd|mono|formula|locale|brand|milestone|policy|time|input|url|slug)/i;

const PHYSICAL_PROP_MAP = new Map([
  ["left", "inset-inline-start"],
  ["right", "inset-inline-end"],
  ["top", "inset-block-start"],
  ["bottom", "inset-block-end"],
  ["width", "inline-size"],
  ["min-width", "min-inline-size"],
  ["max-width", "max-inline-size"],
  ["height", "block-size"],
  ["min-height", "min-block-size"],
  ["max-height", "max-block-size"],
  ["margin-left", "margin-inline-start"],
  ["margin-right", "margin-inline-end"],
  ["margin-top", "margin-block-start"],
  ["margin-bottom", "margin-block-end"],
  ["padding-left", "padding-inline-start"],
  ["padding-right", "padding-inline-end"],
  ["padding-top", "padding-block-start"],
  ["padding-bottom", "padding-block-end"],
  ["border-left", "border-inline-start"],
  ["border-right", "border-inline-end"],
  ["border-top", "border-block-start"],
  ["border-bottom", "border-block-end"],
  ["border-left-width", "border-inline-start-width"],
  ["border-right-width", "border-inline-end-width"],
  ["border-top-width", "border-block-start-width"],
  ["border-bottom-width", "border-block-end-width"],
  ["border-left-color", "border-inline-start-color"],
  ["border-right-color", "border-inline-end-color"],
  ["border-top-color", "border-block-start-color"],
  ["border-bottom-color", "border-block-end-color"],
  ["border-left-style", "border-inline-start-style"],
  ["border-right-style", "border-inline-end-style"],
  ["border-top-style", "border-block-start-style"],
  ["border-bottom-style", "border-block-end-style"],
]);

function splitTopLevelWords(value) {
  const out = [];
  let buf = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      buf += ch;
      if (ch === quote && value[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function logicalizeFourValueShorthand(prop, value, indent) {
  if (prop !== "margin" && prop !== "padding" && prop !== "inset") return null;
  const parts = splitTopLevelWords(value);
  if (parts.length !== 4) return null;
  const [blockStart, inlineEnd, blockEnd, inlineStart] = parts;
  if (prop === "inset") {
    return [
      `${indent}inset-block-start: ${blockStart};`,
      `${indent}inset-inline-end: ${inlineEnd};`,
      `${indent}inset-block-end: ${blockEnd};`,
      `${indent}inset-inline-start: ${inlineStart};`,
    ].join("\n");
  }
  return [
    `${indent}${prop}-block-start: ${blockStart};`,
    `${indent}${prop}-inline-end: ${inlineEnd};`,
    `${indent}${prop}-block-end: ${blockEnd};`,
    `${indent}${prop}-inline-start: ${inlineStart};`,
  ].join("\n");
}

function normalizeViewportValue(value) {
  let next = value
    .replace(/100(?:d|s|l)?vw\b/g, "100%")
    .replace(/calc\(100%\s*-\s*[^)]+\)/g, "100%");
  next = next.replace(/min\(([^,()]+),\s*100%\)/g, "min($1, 100%)");
  return next;
}

function adjustFontSize(value) {
  const trimmed = value.trim();
  if (/var\(--ui-font-adjust/.test(trimmed)) return trimmed;
  if (/^(inherit|initial|unset|revert|revert-layer|smaller|larger|xx-small|x-small|small|medium|large|x-large|xx-large)$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^[\d.]+(?:px|rem|em|%|pt|ch|ex|vw|vh|vmin|vmax)$/i.test(trimmed)) {
    return `calc(${trimmed} + var(--ui-font-adjust, 0rem))`;
  }
  if (/^(?:clamp|min|max|calc)\(/i.test(trimmed)) {
    return `calc(${trimmed} + var(--ui-font-adjust, 0rem))`;
  }
  return trimmed;
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let quote = "";
  let comment = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (comment) {
      if (ch === "*" && next === "/") {
        comment = false;
        i += 1;
      }
      continue;
    }
    if (!quote && ch === "/" && next === "*") {
      comment = true;
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function transformDeclarations(selector, body) {
  const visuallyHidden = /(?:clip\s*:|clip-path\s*:)/i.test(body)
    && /(?:width|inline-size)\s*:\s*1px/i.test(body)
    && /overflow\s*:\s*hidden/i.test(body);
  const allowPosition = POSITION_ALLOWLIST.test(selector) || /::|:before|:after/.test(selector) || visuallyHidden;
  const allowDirection = DIRECTION_ALLOWLIST.test(selector) || /\[dir\s*=|\[lang\s*[\^|]?=/.test(selector);
  let structuralPositionNeutralized = false;

  let next = body.replace(
    /(^|\n|(?<=;))([ \t]*)([-a-zA-Z]+)\s*:\s*([^;{}]+?)(;|$)/g,
    (full, lineStart, indent, rawProp, rawValue, terminator) => {
      let prop = rawProp.toLowerCase();
      let value = rawValue.trim();

      const shorthand = logicalizeFourValueShorthand(prop, value, indent);
      if (shorthand) return `${lineStart}${shorthand}`;

      prop = PHYSICAL_PROP_MAP.get(prop) ?? prop;
      value = normalizeViewportValue(value);

      if (prop === "text-align" || prop === "float" || prop === "clear") {
        if (/^left$/i.test(value)) value = "inline-start";
        if (/^right$/i.test(value)) value = "inline-end";
        if (prop === "text-align") {
          if (value === "inline-start") value = "start";
          if (value === "inline-end") value = "end";
        }
      }

      if (prop === "font-size") value = adjustFontSize(value);

      if (prop === "direction" && !allowDirection && /^(ltr|rtl)$/i.test(value)) {
        return `${lineStart}${indent}/* direction inherits from the locale shell */`;
      }

      if (prop === "position" && !allowPosition && /^(absolute|fixed|sticky)$/i.test(value)) {
        structuralPositionNeutralized = true;
        return `${lineStart}${indent}position: static;`;
      }

      if (prop === "min-block-size" && !allowPosition && /100(?:vh|dvh|svh|lvh)/i.test(value)) {
        return `${lineStart}${indent}min-block-size: auto;`;
      }

      return `${lineStart}${indent}${prop}: ${value};`;
    },
  );

  if (structuralPositionNeutralized) {
    next = next.replace(
      /(^|\n|(?<=;))([ \t]*)(?:inset|inset-inline|inset-block|inset-inline-start|inset-inline-end|inset-block-start|inset-block-end)\s*:\s*[^;{}]+?(?:;|$)/g,
      "$1$2/* inset removed: element participates in normal flow */",
    );
  }

  if (!allowPosition) {
    const hasCenteringInset = /(?:inset-inline-start|margin-inline-start)\s*:\s*50%/.test(next);
    const hasTranslate = /transform\s*:\s*[^;]*translateX\(\s*-50%\s*\)/i.test(next);
    if (hasCenteringInset && hasTranslate) {
      next = next
        .replace(/position\s*:\s*relative\s*;/gi, "position: static;")
        .replace(/inset-inline-start\s*:\s*50%\s*;/g, "inset-inline-start: auto;")
        .replace(/margin-inline-start\s*:\s*50%\s*;/g, "margin-inline: auto;")
        .replace(/transform\s*:\s*[^;]*translateX\(\s*-50%\s*\)[^;]*;/gi, "transform: none;");
    }
  }

  return next;
}

function processSegment(text) {
  let output = "";
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open === -1) {
      output += text.slice(cursor);
      break;
    }
    const close = findMatchingBrace(text, open);
    if (close === -1) {
      output += text.slice(cursor);
      break;
    }

    const headerStart = Math.max(
      text.lastIndexOf("}", open - 1) + 1,
      text.lastIndexOf(";", open - 1) + 1,
    );
    const prefix = text.slice(cursor, headerStart);
    const header = text.slice(headerStart, open);
    const inner = text.slice(open + 1, close);
    output += prefix + header + "{";

    const trimmedHeader = header.trim();
    const nested = trimmedHeader.startsWith("@") && inner.includes("{");
    output += nested ? processSegment(inner) : transformDeclarations(trimmedHeader, inner);
    output += "}";
    cursor = close + 1;
  }
  return output;
}

export function transformCss(css) {
  const normalized = processSegment(css).replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export function walkCssFiles(rootDir) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (["node_modules", ".next", "coverage", ".git"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".css")) files.push(full);
    }
  }
  walk(rootDir);
  return files.sort();
}

export function auditCssText(css, file = "") {
  const issues = [];
  const lines = css.split(/\r?\n/);
  const physical = /(?:^|[;{])\s*(?:left|right|top|bottom|width|height|min-width|max-width|min-height|max-height|margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:/;
  const structuralPosition = /position\s*:\s*(absolute|fixed|sticky)\s*;/i;
  const rawViewport = /100(?:d|s|l)?vw\b/;
  const textPhysical = /(?:^|[;{])\s*text-align\s*:\s*(left|right)\s*;/i;

  let currentSelector = "";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
    if (line.includes("{") && !line.trimStart().startsWith("@")) currentSelector = line.split("{")[0].trim();
    if (physical.test(line)) issues.push({file, line: i + 1, type: "physical-property", text: line.trim()});
    if (rawViewport.test(line)) issues.push({file, line: i + 1, type: "viewport-width", text: line.trim()});
    if (textPhysical.test(line)) issues.push({file, line: i + 1, type: "physical-text-align", text: line.trim()});
    const positionMatches = [...line.matchAll(/position\s*:\s*(absolute|fixed|sticky)\s*;/gi)];
    for (const match of positionMatches) {
      let selectorForPosition = currentSelector;
      const beforeMatch = line.slice(0, match.index ?? 0);
      const localOpen = beforeMatch.lastIndexOf("{");
      if (localOpen >= 0) {
        const previousClose = beforeMatch.lastIndexOf("}", localOpen - 1);
        selectorForPosition = beforeMatch.slice(previousClose + 1, localOpen).trim() || selectorForPosition;
      }
      if (!POSITION_ALLOWLIST.test(selectorForPosition) && !/::|:before|:after/.test(selectorForPosition)) {
        issues.push({file, line: i + 1, type: "structural-position", text: `${selectorForPosition} -> ${line.trim()}`});
      }
    }
    if (/margin-(?:inline-start|left)\s*:\s*50%/.test(line)) {
      issues.push({file, line: i + 1, type: "centering-hack", text: line.trim()});
    }
  }
  return issues;
}

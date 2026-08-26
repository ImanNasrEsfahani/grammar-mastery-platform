import {describe, expect, test} from "vitest";
import {normalizeBuilderSearchParams} from "./PreferencesAwareTestBuilder";

const defaults = {
  mode: "adaptive",
  count: "20",
  difficulty: "all",
};

describe("normalizeBuilderSearchParams", () => {
  test("a lesson selector forces lesson scope and keeps the selected lesson", () => {
    const params = new URLSearchParams("lesson=lesson-42");

    expect(normalizeBuilderSearchParams(params, defaults)).toBe(true);
    expect(params.get("scope")).toBe("lessons");
    expect(params.getAll("lesson")).toEqual(["lesson-42"]);
    expect(params.get("mode")).toBe("adaptive");
    expect(params.get("count")).toBe("20");
    expect(params.get("difficulty")).toBe("all");
  });

  test("lesson scope wins over stale group state", () => {
    const params = new URLSearchParams("scope=related&group=sub-1&lesson=lesson-42");

    normalizeBuilderSearchParams(params, defaults);

    expect(params.get("scope")).toBe("lessons");
    expect(params.get("group")).toBeNull();
    expect(params.getAll("lesson")).toEqual(["lesson-42"]);
  });

  test("legacy comma-separated lessons are canonicalized and deduplicated", () => {
    const params = new URLSearchParams("lessons=a,b,a");

    normalizeBuilderSearchParams(params, defaults);

    expect(params.has("lessons")).toBe(false);
    expect(params.getAll("lesson")).toEqual(["a", "b"]);
    expect(params.get("scope")).toBe("lessons");
  });

  test("a group selector activates related scope when there is no lesson", () => {
    const params = new URLSearchParams("group=sub-1");

    normalizeBuilderSearchParams(params, defaults);

    expect(params.get("scope")).toBe("related");
    expect(params.get("group")).toBe("sub-1");
  });

  test("explicit mode, count and difficulty are preserved", () => {
    const params = new URLSearchParams("scope=all&mode=custom&count=30&difficulty=hard");

    expect(normalizeBuilderSearchParams(params, defaults)).toBe(false);
    expect(params.get("mode")).toBe("custom");
    expect(params.get("count")).toBe("30");
    expect(params.get("difficulty")).toBe("hard");
  });
});

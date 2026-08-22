import {describe, expect, test} from "vitest";
import {
  DEFAULT_GRAMMAR_BOOK_SLUG,
  grammarLessonUrl,
  lessonHtmlFileName,
  resolveGrammarBookSlug,
} from "./books";

describe("grammar content registry", () => {
  test("uses the canonical intermediate book by default", () => {
    expect(resolveGrammarBookSlug()).toBe(DEFAULT_GRAMMAR_BOOK_SLUG);
  });

  test("rejects an unknown book slug", () => {
    expect(resolveGrammarBookSlug("unknown-book")).toBeNull();
  });

  test("maps lesson numbers to zero-padded HTML filenames", () => {
    expect(lessonHtmlFileName(1)).toBe("L01.html");
    expect(lessonHtmlFileName(9)).toBe("L09.html");
    expect(lessonHtmlFileName(52)).toBe("L52.html");
  });

  test("builds a static same-origin lesson URL", () => {
    expect(grammarLessonUrl(DEFAULT_GRAMMAR_BOOK_SLUG, 1)).toBe(
      "/grammar/grammaire-progressive-francais-intermediaire-3e/L01.html",
    );
  });

  test("fails closed outside the configured book range", () => {
    expect(() => grammarLessonUrl(DEFAULT_GRAMMAR_BOOK_SLUG, 53)).toThrow(
      RangeError,
    );
    expect(() => lessonHtmlFileName(0)).toThrow(RangeError);
  });
});

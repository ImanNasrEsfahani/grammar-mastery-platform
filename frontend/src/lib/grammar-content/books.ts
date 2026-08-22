export const GRAMMAR_BOOKS = {
  "grammaire-progressive-francais-intermediaire-3e": {
    slug: "grammaire-progressive-francais-intermediaire-3e",
    titleFr: "Grammaire Progressive du Français — Niveau intermédiaire",
    titleFa: "گرامر پیش‌روندهٔ زبان فرانسه — سطح متوسط",
    edition: "3e édition",
    lessonCount: 52,
    publicRoot: "/grammar/grammaire-progressive-francais-intermediaire-3e",
  },
} as const;

export type GrammarBookSlug = keyof typeof GRAMMAR_BOOKS;

export const DEFAULT_GRAMMAR_BOOK_SLUG: GrammarBookSlug =
  "grammaire-progressive-francais-intermediaire-3e";

export function isGrammarBookSlug(value: string): value is GrammarBookSlug {
  return Object.prototype.hasOwnProperty.call(GRAMMAR_BOOKS, value);
}

export function resolveGrammarBookSlug(
  value?: string | null,
): GrammarBookSlug | null {
  if (!value) return DEFAULT_GRAMMAR_BOOK_SLUG;
  return isGrammarBookSlug(value) ? value : null;
}

export function getGrammarBook(slug: GrammarBookSlug) {
  return GRAMMAR_BOOKS[slug];
}

export function lessonHtmlFileName(lessonNo: number): string {
  if (!Number.isInteger(lessonNo) || lessonNo < 1 || lessonNo > 99) {
    throw new RangeError("lessonNo must be an integer from 1 to 99.");
  }
  return `L${String(lessonNo).padStart(2, "0")}.html`;
}

export function grammarLessonUrl(
  slug: GrammarBookSlug,
  lessonNo: number,
): string {
  const book = getGrammarBook(slug);
  if (lessonNo > book.lessonCount) {
    throw new RangeError(
      `Lesson ${lessonNo} is outside the configured ${book.lessonCount}-lesson book.`,
    );
  }
  return `${book.publicRoot}/${lessonHtmlFileName(lessonNo)}`;
}

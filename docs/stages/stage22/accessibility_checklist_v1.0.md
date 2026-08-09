# Stage 22 Accessibility Checklist

**Owner:** Iman  
**Version:** 1.0  
**Target:** WCAG 2.2 AA implementation baseline; formal audit remains Stage 24.

## Implemented and testable

- [x] Semantic headings, landmark navigation and a skip link are present.
- [x] Every option is a native button with a minimum 48 × 48 CSS-pixel target.
- [x] Keys 1–4 select options; Enter submits; N advances after feedback.
- [x] Focus moves to the new question heading and remains visible with `:focus-visible`.
- [x] Correct/incorrect feedback uses text and an icon in addition to color.
- [x] Submission, feedback, offline and error messages use polite live regions.
- [x] Disabled/submitting states prevent duplicate activation.
- [x] Persian UI containers use RTL; French stems use `lang="fr" dir="ltr"`; options use `bdi dir="auto"`.
- [x] Reduced-motion preferences disable nonessential transitions.
- [x] Color tokens meet a design baseline and are not the sole carrier of meaning.
- [x] Touch navigation respects `env(safe-area-inset-bottom)`.
- [x] Error summaries expose a stable request ID when available.

## Manual review required before owner acceptance

- [ ] Iman reviews Persian and English labels in the actual browser.
- [ ] Keyboard-only run: login → create test → answer → complete → result.
- [ ] Screen-reader run with VoiceOver and NVDA across one correct and one incorrect answer.
- [ ] 200% and 400% zoom checks without horizontal page scrolling.
- [ ] High-contrast/forced-colors verification.

## Stage 24 gates

- Automated axe scan across all required Stage 19 states.
- Cross-browser focus and visual-regression suite.
- Measured contrast evidence for final brand tokens.
- Long-session performance and memory profile after hundreds of questions.

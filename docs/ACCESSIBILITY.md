# Accessibility Review (Phase 10)

Target: **WCAG 2.1 AA** on desktop and phone, in light and dark themes. Date: 2026-10-23.

## 1. Automated coverage

| Check | Where |
| --- | --- |
| axe (wcag2a, wcag2aa, wcag21aa; serious and critical fail the build) on 22 top-level pages and tabs, light and dark | `tests/e2e/navigation.spec.ts` |
| axe on every prospect profile tab (overview, verification, audit, score, contacts, next steps, reports, proposals, activity), the proposal editor, the proposal print view and the meeting brief, light and dark | `tests/e2e/accessibility.spec.ts` |
| axe on the Website Studio list and on a concept with recorded evidence (run selector, the four evidence groups, reviews, brief), light and dark | `tests/e2e/studio.spec.ts` |
| axe on the Studio Asset vault (upload, review, permissions, references, history) and the Brand Kit (logo selection, palette, typography, direction, version history), light and dark | `tests/e2e/studio-assets.spec.ts` |
| axe inside flows (Next steps after a reply, outreach dialogs, contacts) | `e2e/conversion`, `e2e/outreach`, `e2e/contacts` |
| Keyboard: the skip link moves focus to the main content; a dialog opened from the keyboard keeps Tab inside it, closes on Escape and returns focus to its opener; tabs move with the arrow keys | `e2e/accessibility` |
| Reduced motion: with `prefers-reduced-motion: reduce`, no animation or transition runs longer than 0.01 ms | `e2e/accessibility` |
| Phone layouts: every main page fits a Pixel 7 screen without horizontal scroll; the navigation drawer opens and navigates | `e2e/responsive` (mobile project) |

The desktop project (Chrome) runs every spec except the phone layouts; the mobile project (Pixel 7) runs the phone layouts. Axe and keyboard checks on the phone viewport are not automated yet.

## 2. Manual review

| Area | Result |
| --- | --- |
| Landmarks and headings | One `h1` per page; cards use `h2`; `main#main` is the skip target; navigation is a labelled landmark. |
| Forms | Every input has a visible label through `Field`; required fields are marked; hints and errors are tied to inputs with `aria-describedby`. |
| Status not by colour alone | Badges carry text (for example "Opt-out", "Awaiting decision"); charts have legends and table views with CSV. |
| Focus | Visible focus rings on every control; dialogs trap focus (Radix) and now return it (fixed in this review). |
| Language | `lang="en-GB"`. Plain-language copy; no instruction relies on shape or position alone. |
| Print views | Proposal, report and meeting brief print views keep heading order and readable contrast in print. |

## 3. Findings

| ID | Finding | Status |
| --- | --- | --- |
| A-1 | Dialogs did not return focus to the control that opened them, leaving keyboard and screen-reader users at the top of the page (WCAG 2.4.3). Dialogs open from state rather than a Radix trigger, and an autofocused field skips Radix's own handling. | Fixed in `src/components/ui/dialog.tsx`: focus goes back to the newest focused element that is still on the page. |
| A-2 | (Phase 9) The source label in intent badges failed colour contrast (opacity). | Fixed; covered by axe. |

## 4. Not covered yet

- **Screen-reader passes** with NVDA, JAWS, VoiceOver and TalkBack: not done. Automated checks cannot judge announcements, reading order in complex tables, or toast timing. Recommended before an external launch.
- **WCAG 2.2** (target size, focus not obscured, dragging alternatives): not audited. The pipeline kanban supports moving cards without dragging (stage menu), but target sizes on phones have not been measured against 2.2's 24 px minimum.
- **Zoom to 400 %** and text spacing overrides: checked by eye on key pages only.
- **Local languages:** the interface is English only.

---
name: Learning Studio campus learning itinerary
description: A Windows learning workspace built around real subjects, focused sections and working inline experiments.
colors:
  identity-light: "#1B5C48"
  identity-text-light: "#FFFFFF"
  accent-light: "#1B6D56"
  accent-secondary-light: "#BA5839"
  canvas-light: "#EEF2EC"
  contents-light: "#E9F0E8"
  reading-light: "#FDFEF9"
  surface-light: "#F5F8F1"
  figure-light: "#F6FAF3"
  ink-light: "#1C3028"
  heading-light: "#15362A"
  secondary-light: "#4C6356"
  link-focus-light: "#176858"
  border-light: "#C8D5C7"
  divider-light: "#DCE5D8"
  hover-light: "#E3EFE2"
  selected-light: "#D8EAD6"
  success-light: "#286A41"
  warning-light: "#805B16"
  danger-light: "#AC3938"
  identity-dark: "#13291F"
  identity-text-dark: "#E6F0E1"
  button-dark: "#ADDDBA"
  button-text-dark: "#14271B"
  accent-dark: "#A9DCB9"
  accent-secondary-dark: "#EEAA82"
  canvas-dark: "#102019"
  reading-dark: "#182E23"
  surface-dark: "#1C3428"
  input-dark: "#11271C"
  popover-dark: "#223D2D"
  figure-dark: "#1C3325"
  heading-dark: "#F0F6E9"
  secondary-dark: "#BED0B9"
  link-dark: "#A2D8B2"
  focus-dark: "#BBE7C4"
  border-dark: "#415D45"
  divider-dark: "#304B35"
  hover-dark: "#294A32"
  selected-dark: "#28472F"
  success-dark: "#A0D8A9"
  warning-dark: "#E5C47D"
  danger-dark: "#F2AAA0"
typography:
  page-title:
    fontFamily: 'Inter, "Segoe UI", sans-serif'
    fontSize: "34px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  launch-title:
    fontFamily: 'Inter, "Segoe UI", sans-serif'
    fontSize: "31px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  section-title:
    fontFamily: 'Inter, "Segoe UI", sans-serif'
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  course-title:
    fontFamily: 'Inter, "Segoe UI", sans-serif'
    fontSize: "21px"
    fontWeight: 650
    lineHeight: 1.3
  subject-title:
    fontFamily: 'Inter, "Segoe UI", sans-serif'
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.3
  reading:
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0em"
  interface-body:
    fontFamily: 'Inter, "Segoe UI", sans-serif'
    fontSize: "15px"
    lineHeight: 1.6
  action:
    fontFamily: 'Inter, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  navigation:
    fontFamily: 'Inter, "Segoe UI", sans-serif'
    fontSize: "13px"
    lineHeight: 1.5
  utility:
    fontFamily: 'Inter, "Segoe UI", sans-serif'
    fontSize: "12px"
    lineHeight: 1.5
  evidence-caption:
    fontFamily: 'Inter, "Segoe UI", sans-serif'
    fontSize: "10px"
    lineHeight: 1.6
rounded:
  stage: "6px"
  contents-row: "7px"
  control: "8px"
  composer: "9px"
  compact-player: "10px"
  temporary-panel: "12px"
  course: "14px"
  launchpad: "16px"
spacing:
  micro: "4px"
  control-gap: "8px"
  action-gap: "10px"
  compact: "12px"
  inset: "16px"
  section-gap: "20px"
  shell-inline: "24px"
  group: "28px"
  reader-inline: "32px"
  home-inline: "46px"
  home-bottom: "64px"
components:
  button-primary:
    backgroundColor: "{colors.identity-light}"
    textColor: "{colors.identity-text-light}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
    height: "44px"
  button-secondary:
    textColor: "{colors.ink-light}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
    height: "44px"
  button-primary-dark:
    backgroundColor: "{colors.button-dark}"
    textColor: "{colors.button-text-dark}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
  appbar:
    height: "64px"
    backgroundColor: "{colors.identity-light}"
    textColor: "{colors.identity-text-light}"
    padding: "0 24px"
  subject-contents:
    width: "276px"
    backgroundColor: "{colors.contents-light}"
    typography: "{typography.navigation}"
  section-step:
    width: "180px"
    rounded: "{rounded.control}"
    typography: "{typography.navigation}"
    padding: "7px 10px 7px 6px"
  section-step-current:
    backgroundColor: "{colors.selected-light}"
    textColor: "{colors.heading-light}"
    rounded: "{rounded.control}"
  course-container:
    backgroundColor: "{colors.reading-light}"
    rounded: "{rounded.course}"
    padding: "25px 27px 0"
  input-field:
    backgroundColor: "{colors.reading-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.control}"
  button-contextual:
    textColor: "{colors.ink-light}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
  coverage-status:
    textColor: "{colors.secondary-light}"
    typography: "{typography.evidence-caption}"
  reading-document:
    backgroundColor: "{colors.reading-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.reading}"
---

# Design System: Learning Studio campus learning itinerary

## Overview

**Creative North Star: "The campus learning itinerary"**

A contemporary course workspace gives subjects, their actual pathways and focused lesson sections a clear order. A deep green identity band, pale green neutral grounds and an openly licensed sans-serif give the application a calm, direct character. Compact native controls leave room for readable explanations and working scientific figures.

The signature is a connected, selectable section trail beside the subject pathway. Home, course overview and focused learning use one visual language; a contextual tutor and secondary History support it. The rejected folio's permanent prompt dock and transcript-first hierarchy are confirmed anti-references. The material is digital, without simulated paper or decorative raster imagery.

**Key Characteristics:**

- Deep green identity with independent light, dark and custom appearance.
- Real subject pathways and numbered lesson-section trails.
- Readable prose and broad inline scientific working space.
- Compact task controls and restrained rounded containers.
- Contextual questions, secondary history and honest evidence labels.

This records the implemented 2.4 source and curated native captures in `docs/images/`. Historical review logs are archived separately; the current verification scope is documented in `docs/VERIFICATION.md`. No generated raster is used.

## Colors

The factory schemes combine deep green-teal identity, pale green neutral grounds and a restrained warm secondary accent. Frontmatter values come from `src/lib/themes.ts`; runtime semantic variables and learner configuration remain authoritative. The sidecar's eight-step ramps are synthesized swatch-preview metadata; they do not add implemented semantic colors.

### Primary

- **Campus Green** (`identity-light`): light application band and primary button, paired with the selected-text foreground.
- **Learning Green** (`accent-light` / `accent-dark`): selected section numbers and semantic emphasis.
- **Dark Course Ground** (`identity-dark`): the dark band uses sidebar ground and body-text foreground.
- **Pale Green Action** (`button-dark`): dark primary buttons use their distinct dark foreground.

### Secondary

- **Terracotta** (`accent-secondary-light` / `accent-secondary-dark`): the existing secondary accent. Scientific participant colors remain independently meaningful.

### Neutral

- **Learning / Contents / Reading Ground:** separate canvas, pathway and document roles.
- **Surface / Figure Ground:** separate component and figure roles; dark inputs and popovers retain dedicated grounds.
- **Ink / Heading / Secondary:** body, title and supporting text remain distinct in both schemes.
- **Border / Divider / Hover / Selected:** quiet structural edges and explicit themed interaction states.
- **Success / Warning / Danger:** actual status meaning, never decorative evidence of learning.

**The Learner Configuration Rule.** Factory tokens are defaults. Preserve independent edited palettes and fonts; version 4 upgrades only eligible untouched factory configurations. A single edited color prevents that factory replacement.

**The Identity Foreground Rule.** Navigation and every nested label use the identity foreground. Recorded native 13px navigation contrast is 7.86:1 in light and 13.13:1 in dark; these measurements support that specific repair, not complete accessibility conformance.

## Typography

**Display and Interface Font:** bundled Inter, with Segoe UI and sans-serif fallbacks. **Reading Font:** bundled Inter, with Segoe UI, Arial and sans-serif fallbacks. **Mathematics:** KaTeX. Normal and italic variable Inter files ship under SIL OFL 1.1; installed system fonts are fallbacks.

Reading settings independently control family, size, heading scale/weight, bold weight, line height, letter spacing, paragraph spacing and measure. Defaults are an 18px reading size, 1.7 line height, 1.2em paragraph spacing, 760px measure and 600 heading weight. Reading's size controls allow 13–28px and reset to 18px; application zoom is separate.

### Hierarchy

- **Page / launch title:** home and course overview hierarchy; compact values reduce to 29px and 26px respectively.
- **Section title:** the player heading role. Teaching concept titles independently inherit the reading font and heading weight at `1.45 × reading size` (26.1px by default).
- **Course / subject title:** actual saved lesson and subject identity without decorative overlines.
- **Reading:** selected prose measure; equations and figures can use the wider lane.
- **Action / navigation / utility / evidence caption:** task controls, pathways and genuinely secondary metadata. Small contents captions are not the primary navigation style.

The interface uses a contextual scale, not a single ratio. Actual stylesheet values include 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 34 and 36px declarations plus reading-derived sizes. The new home/overview overrides shared 36px subject headings to 34px. Preserve role and context rather than promoting every inherited declaration into a display token. Normal verified desktop/compact navigation is 13px; below 660px the shell has an 11px fallback.

**The Reading Independence Rule.** Preserve reading size and scientific-label scale. Make space by reducing presentation layers and applying the actual responsive layout.

## Layout

The desktop has a single-row 64px identity bar and collapsible subject contents with an effective default width of 276px. Saved resizing permits larger widths up to 440px; the rendered column enforces a 276px minimum. Below 1050px window width Contents becomes a deliberate overlay: 292px wide, limited to 88vw.

A compact breadcrumb/tool line and course identity precede the player. Section position, real stage anchors, optional guiding question and History share its compact top line; a connected trail and native All sections picker follow. The reader scrolls within the player and Back / Ask about this page / Next stay at the lower boundary. The current original content remains mounted; History exposes the complete original record. Section viewing does not create mastery evidence.

Reader padding is 32px inline on desktop. The full content lane is at most 1060px and prose defaults to an independently selected 760px measure. Presentation spacing exposes useful working geometry in the first viewport without changing saved content order or reducing type. The optional question area opens below content, at most 290px tall. Ordinary focused learning has no permanent composer or right laboratory.

Home and course overview center within 1400px with 46px desktop gutters. Home has a broad start/resume region and a two-column course index. Course overview has a main pathway and 300px support column. At 1180px gutters narrow and support becomes 265px; at 960px primary grids stack; at 700px the course index becomes one column. Player steps narrow from 180px to 150px at 1050px and yield to the native picker at 720px. Shell details recede at 950px. Below 660px the shell has a 58px minimum-height fallback. These are source breakpoints, not verification claims for every window size.

Spacing follows actual 4–12px control gaps, 16–28px insets/groups, 24px shell gutters and 32px reader gutters. Reading opens a local 340px popover below its trigger; native compact evidence includes its open state below the global navigation.

## Elevation & Depth

Permanent reading and course surfaces are flat, separated by tones, themed one-pixel borders and real dividers. The identity band is the strongest contrast plane. Resting course cards have no decorative shadow; hover changes surface and border.

### Shadow Vocabulary

- **Reading menu** (`0 12px 30px #10251b22`): temporary typography controls.
- **Notes panel** (`0 14px 36px #10251b22`): floating local notes.
- **Contents scrim** (`#10251b66`): overlay backdrop.

Course background/border transitions use 160ms ease. Pending motion communicates work; reduced-motion handling removes the thinking animation and home/course transitions.

**The Flat Working Surface Rule.** Reserve depth for temporary controls. Give working figures room through layout rather than ornamental shadows or smaller geometry.

## Shapes

The frontmatter records real radius families: small stage controls, contents rows, ordinary controls, composer, compact player, temporary panel, course containers and broad launch region. Pathway rows use quiet boundaries; numbered positions are circles. The player uses rounded top corners and a flat lower boundary.

Borders are one themed pixel. Keyboard focus uses a two-pixel `--focus` outline and three-pixel offset. Identity-region actions use the identity foreground for a visible focus ring. Icons are actual SVGs rather than text-glyph substitutes.

## Components

### Buttons

Continuation uses button/selected-text roles; Back uses a themed border and transparent ground. Footer actions have a 44px minimum height, 10px 15px padding and control radius. Ask is a quieter text action with selected ground while expanded. Enabled footer hover uses brightness 0.97; disabled controls use 0.45 opacity without moving. The launch region inverts its primary action against identity and outlines secondary actions. Every variant keeps keyboard focus visible.

### Inputs / Fields

Use input ground, body-text color and themed border. Native mode/section selects are intentional; the section picker remains when the trail hides. The contextual composer uses 15px / 1.6 reading type, a 68px minimum height and composer radius. Reading is a native disclosure: outside pointer interaction closes it; Escape closes it and restores trigger focus.

### Navigation

The global band contains My learning, Lesson, Library, Connections and Review, with advanced tools in a disclosure and compact account/search/settings utilities. Descendant text inherits the band foreground; current/hover state uses a 15% foreground tint. Subject contents remains local: genuine pathway, current node, study sessions, memory and sources. Its selected rows use the selected ground.

### Section Trail and Status

The signature trail uses real 180px section buttons, 28px numbered circles and a quiet connecting line. Current selection uses selected ground, heading text and an accent circle. Full section labels remain in title/accessibility text and the native picker even when the trail truncates. Pending, partial and failed labels reflect actual state. Covered and demonstrated icons retain distinct meanings and a nearby explanation.

### Cards / Containers

Course-index containers use reading ground, a themed border, course radius, text identity, saved context and divided footer. Hover changes surface/accent border over 160ms. Start/resume regions use identity ground, an inverse primary action and a tinted supporting area. Course overview uses the same language for the actual next lesson and quiet support for evidence/materials.

### Scientific Content and Contextual Tools

Definitions, prose, equations, figures and optional checks retain original order. Figures use the wide inline lane and retain controls, source/approximation labels and instance state; fullscreen preserves the mounted instance. Notes and selection explanations stay near content. History starts with Conversation record, explanation and Return to lesson; its removed overline is not a reusable style.

## Do's and Don'ts

### Do:

- **Do** use the learner's semantic palette and independent typography settings throughout new surfaces.
- **Do** preserve the real pathway, original content order, reading position and scientific instance state.
- **Do** give readable explanations and meaningful working geometry the main lesson area.
- **Do** expose keyboard focus, honest pending/error states and the difference between coverage and demonstrated understanding.
- **Do** label local examples, controlled acceptance content and scientific approximations honestly.
- **Do** cite final native captures and scoped verification records with their actual limits.

### Don't:

- **Don't** restore the rejected folio's permanent prompt dock, transcript-first hierarchy or compulsory right laboratory.
- **Don't** overwrite a custom palette or font to force the factory identity.
- **Don't** add decorative eyebrows, text-glyph icons or hard offset shadows to this world.
- **Don't** manufacture mastery, XP, streaks, source pages, remaining quota or numerical scientific evidence.
- **Don't** shrink teaching type or scientific geometry to compensate for unnecessary presentation chrome.
- **Don't** infer complete release or accessibility verification from captures or the two-fix design verdict.

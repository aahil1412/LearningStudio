# Learning-first presentation architecture

## Existing authoritative systems

This is an in-place presentation upgrade. Electron authentication/provider communication, subject tables, curriculum jobs/proposals, FTS retrieval, source guides, original conversations/branches, evidence/review, visual instances, textbook, graph, notebook/canvas and portable exports remain authoritative. The upgrade does not introduce a competing curriculum, chat, memory or simulation backend.

## Learning sequence

`src/lib/learningSequence.ts` projects existing assistant messages and inherited branch ancestry into stable learning units. IDs are original message IDs, not newly serialized copies. Overlapping ancestry is deduplicated in favor of the original canonical message. Titles derive from existing concept/headings or position, with bounded safe fallbacks. Code-fenced text is not mistaken for a title. Partial, failed and pending explanations remain units so their existing recovery actions stay reachable. Original learner questions remain accessible in History and the guiding-question disclosure.

The projection identifies Understand, Explore and Check stages from the actual ordered content block indices. It does not invent a completed learning stage, split a transcript destructively, or infer demonstrated understanding from viewing a section.

## React composition and preservation

`LearningPlayer.tsx` provides the section trail/selector, stage jumps, Back/Next, History and contextual Ask controls. `App.tsx` remains responsible for the existing original message projection, tutor request service, notes and visual provider. In focused mode inactive original articles receive `hidden`; History reveals the original transcript. Visuals are not reconstructed from a second copy to populate the current section.

The optional `Lesson.studyView = {mode, messageId?}` is validated in Electron storage and included in the normalized conversation mirror. It lives in the existing versioned lesson JSON, so a SQL migration is unnecessary. Missing settings are compatible with older data. Source-anchor navigation reveals History before locating a message, ensuring graph/search/highlight links reach their original content.

## Visual lifecycle

The existing `VisualWorkspaceProvider` owns one instance, its reusable state and a stable portal host. An optional set of visible origin message IDs lets hidden lesson sections pause animation using the established runtime visibility signal. Fullscreen remains visible and other notebook/canvas contexts retain the prior behavior. Changing sections does not remount a plot, molecule viewer or 3D camera. The actual native suite checks host and canvas identity plus computed values and camera state across navigation and restart.

## Home, courses and tools

`SubjectsHome` and `SubjectWorkspace` recompose the current subject snapshots, saved lessons and callbacks. The home uses real latest lessons for Resume and explicitly labeled local examples when appropriate. The course overview uses actual nodes, source guides, evidence and notes. Existing subject CRUD, intake, proposals, source review/adoption, archived restore, manual editing and evidence operations are reused.

`StudioShell` provides stable global destinations and a tools menu. The ordinary lesson has no permanent prompt dock; Ask is deliberate and uses the same existing request service, cancellation, provider settings, bounded context and recovery. Reading controls and Note/Export actions remain accessible without switching to History.

## Appearance compatibility

The new `learning-studio.css` defines composition over the existing token system and is loaded after the original shared feature styles. `learning-center-home.css` and `learning-player.css` scope new components. Custom CSS variables remain the source for reading, figures, selected states and controls.

Appearance version 4 upgrades only exact untouched 2.3 Studio factory palettes (and the already-supported eligible older defaults). A single edited color, saved custom palette or independently selected legacy preset prevents replacement. Typography is retained independently. Tests freeze the old factory colors as data and verify both independent schemes and custom-preservation behavior.

## Validation boundaries

Native tests use real Windows Electron, production renderer/IPC/SQLite and foreground frame delivery in isolated temporary profiles. Controlled transport is explicitly labeled; it is not a claim of fresh live connected-model quality or speed. Existing unit/migration, source/provider, scientific, export and native regression suites remain required. Actual results and screenshots are recorded separately from the earlier 2.3 release.

# Learning Studio 2.4: studying in a learning workspace

The app opens at **My learning**. Your subjects and actual last lesson provide the starting points. There is no fabricated activity history, daily streak or mastery score. Without saved learning, create a broad subject, use a curriculum or study a textbook. The three explicitly labeled example lessons run locally and can be explored without model authorization.

## A subject and its pathway

Open a subject to see its goal, actual next topic, learning pathway and saved study tools. Coverage and demonstrated understanding are separate. Opening a lesson or clicking Next does not establish understanding. Learning setup and optional assessment remain editable. The existing pathway proposal/job controls, topic editing, memory inspection, archive/restore, export, and source-guide adoption keep their existing storage and safeguards.

To follow a university curriculum or textbook, choose the corresponding action on My learning or within the subject's Study material. Import an authorized local document, paste actual source text, or use a readable public HTTPS source. Review the detected sections before adoption. The tutor uses bounded source excerpts and shared subject memory; it does not assume it has read unseen chapters or invent page references.

## Work through a lesson

An existing explanation is presented as a section using its original content blocks. Numbered section links, the section selector and Back/Next move between actual saved assistant explanations. Understand, Explore and Check jump to the corresponding content when it exists. At the last saved section, Continue learning requests a new explanation using the existing tutor and provider selection. Optional checks can be skipped; navigation creates no mastery evidence.

**Ask about this page** opens the question area deliberately. You can request a simpler explanation, an example or a tangent and close the area to reclaim the reading space. The existing Learn, Explore, Deep Dive, Practice and Review modes are selectable in Study mode. Context, citations and the exact lesson objective are retained.

**History** opens the full conversation record. Original learner questions, assistant messages, partial/error states, branches and message actions remain available. Return to lesson restores focused reading. Jumping to an original source through search, highlights or the graph reveals the corresponding record so the target cannot stay hidden in an inactive section.

## Keep useful work

Interactive figures stay inline and keep their original validated specifications, state and live rendering host. Returning to a section preserves parameters, camera and selections. Hidden sections pause playback; they are not regenerated. Fullscreen, copying, saving and export remain figure actions. Notes stays inside the reading region. Reading controls, Export HTML, subject sources and the tools menu remain available.

The selected section and lesson/history view are saved with the existing lesson record. They survive restart and portable data operations. Older lessons without this optional setting open at their latest explanation. No existing transcript is rewritten or duplicated to create the lesson view.

## Appearance and preserved data

The default palettes use a deep green identity with a light or dark reading ground and bundled openly licensed Inter. Light, dark, system and all custom colors/fonts remain editable. Only an exact untouched 2.3 factory palette is upgraded; any learner-edited palette or saved custom preset is preserved. Reading size and overall application zoom remain separate controls.

This release adds optional fields to the existing validated lesson JSON and changes its presentation. It introduces no SQL migration and never resets the database. Older migration, backup/restore, subject archive and original evidence records remain part of regression verification.

## Windows PowerShell

```powershell
Set-Location .\learning-studio
npm ci
npm run build
npm start
```

For a Windows installer:

```powershell
npm run package -- --config.directories.output=release/2.4.0
```

Use the packaged installer on machines without Node.js. Current validation and any untested scope are recorded in [the verification report](VERIFICATION.md).

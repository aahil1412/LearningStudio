# Local data, privacy and fresh starts

## Where learning data lives

On a normal Windows installation, the learning library is stored under:

```text
%APPDATA%\Learning Studio\learning-studio.sqlite
```

SQLite contains subjects, conversations, curriculum, evidence, notes, highlights, resources and saved visualization state. A configured `STUDIO_DATA_DIR` overrides the default profile directory.

The installer and source repository contain no saved learning library. Upgrades normally reuse this local profile, so reinstalling alone is not a history reset. A different person installing on a new computer starts with an empty library.

## Start with an empty library

Close Learning Studio completely before changing its profile. Move the learning database, its existing `-wal`/`-shm` companions, and any `learning-studio.sqlite.pre-*` backups into a private backup folder outside the source repository. Reopen the application to create an empty library. Never move a live SQLite database while the app is running.

This removes the old learning library from active use. Database-stored preferences also return to defaults unless deliberately preserved. The encrypted account connection files are separate; do not delete, open, publish or share them merely to clear chats. Imported originals and image caches can be moved into the same private backup if no longer wanted.

Keep the backup until you are certain you no longer need the old material. Use the application's reviewed backup/restore workflow to restore editable data. Restoring an old library intentionally brings its learning history back.

## AI and exports

Relevant content is sent to the explicitly selected AI provider when you request AI assistance. Subject context is retrieved within a budget; the application does not need to send every conversation or the complete graph on each request.

Credentials use Electron safeStorage / Windows DPAPI. They are not part of learning exports. Background model use requires explicit consent. External providers have their own data handling and billing terms, and the app never silently falls back to another provider.

HTML exports include selected content. Decide whether to include your questions, notes and annotations before sharing. Imported documents and retrieved figures retain their own copyright and licensing restrictions.

## What belongs on GitHub

Publish source code, tests with synthetic/public fixtures, documentation and curated nonprivate screenshots. Exclude local databases, private backups, imported books, browser profiles, credentials, API keys, dependency folders and generated build/test output. `.gitignore` provides defaults; review your own future additions too.

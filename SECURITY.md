# Security and privacy reports

Do not include authentication tokens, API keys, private conversations, documents or local database files in public issues.

Use GitHub private vulnerability reporting if it is enabled for the repository. Otherwise, ask the maintainer for a private reporting channel without publishing exploit details or sensitive data. No maintainer contact address is assumed here.

Useful reports include the application version, Windows version, a minimal synthetic reproduction and the affected component. Redact local usernames and personal file paths where possible.

The application uses Electron context isolation, validated IPC, SQLite transactions and Windows-backed credential encryption. Model-generated content is data for trusted renderers, not arbitrary executable code. These controls reduce risk; they are not a guarantee that a desktop application has no vulnerabilities.

# Secrets (local only — not in git)

GitHub push protection blocks committing real keys. After clone, add locally:

1. Copy `.env.example` → `.env` and set `GROQ_API_KEY`, `ROBOFLOW_API_KEY`, etc.
2. Place Firebase service account JSON files in this folder:
   - `serviceAccountKey.json` (primary project)
   - `serviceAccountKey-secondary.json` (optional failover)

Or use GitHub’s “allow secret” links from the failed push email to push them if your repo policy allows it.

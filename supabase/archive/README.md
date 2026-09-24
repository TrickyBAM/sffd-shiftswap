# Archived SQL (pre-v1)

These files are **superseded by the v1 migrations** in `supabase/migrations/`
(`0001_*.sql` onward, see `docs/ARCHITECTURE.md` §6); they are kept for history only.
Do not apply them to the v1 database.

| File | What it was |
|---|---|
| `schema-backup.sql` | Snapshot of the original (pre-v1) production schema, taken 2026-07-03. |
| `migrations/202607100001_add_atomic_swapmatch_rpc.sql` | July 2026 atomic SwapMatch RPC. |
| `migrations/202607100002_tighten_direct_write_policies.sql` | July 2026 RLS tightening. |
| `rollbacks/*.sql` | Rollbacks for the two July migrations (same file names, hence the sub-folders). |
| `ATOMIC-SWAPMATCH-ROLLOUT.md` | Rollout notes for the July migrations. |

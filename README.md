# Study Planner v43 — final optimized build

Final hardening pass:
- No top-level deletion of weekend sessions when the SQL is run.
- ↑/↓ course reordering only re-dates incomplete sessions; completed history and timer logs are preserved.
- Changing planned days no longer wipes and recreates the whole calendar.
- Resizing only adds missing sessions and removes surplus sessions when they have no timer logs.
- Restoring Saadi → Mimouni → Tahiri order no longer duplicates completed courses or resets progress.
- Restore clears only future Day Off markers.
- Existing Undo, Day Off, timer, Drive links, login, viewer mode and monthly calendar are preserved.
- The ZIP contains one `supabase.sql`.

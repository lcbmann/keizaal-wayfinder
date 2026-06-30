# AGENTS.md

## Project

Keizaal Wayfinder is a TypeScript Discord bot for the Ranger Corps. Discord state is managed through slash commands and Discord interactions; persistent data lives in Supabase.

## Commands

Use these project commands:

```bash
npm run check
npm run build
npm run dev
npm run deploy-commands
```

Run `npm run check` after TypeScript changes. Run `npm run build` before deploy-oriented changes. If slash command definitions change, remind the user to run `npm run deploy-commands`.

## Database

Supabase migrations live in `src/db/migrations/` and should be applied in filename order. When adding a table or column, add a new numbered migration instead of editing an already-applied migration. Keep `src/db/supabase.ts` row types in sync with schema changes.

## Discord Bot Notes

- `src/commands/` contains slash command definitions and handlers.
- `src/components/` contains interaction handlers for buttons/select menus.
- `src/services/` contains the behavior that touches Discord and Supabase.
- Prefer updating existing services over putting database or Discord side effects directly into command files.
- Any command shape change needs slash command redeployment.

## Trailmarks

Trailmark panel state is stored through `bot_message_state`. Trailmark create/edit/deactivate should refresh the stored panel when possible. Trailmark access is temporary and only one active Trailmark session should exist per user.

## Roles

Main rank roles are cumulative. Do not change sync behavior to remove lower rank roles from higher ranked users unless explicitly requested.

## Secrets

Never commit `.env` or print secrets in output. If secrets have been exposed in chat or logs, tell the user to rotate the Discord token and Supabase service role key.

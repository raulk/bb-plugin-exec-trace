---
name: example-todos
description: Read and update the Exec Trace plugin's example todo list with the `bb exec-trace` CLI. Use when the user asks to add, complete, reopen, remove, or review todos, or when the steps of a task should be tracked as todos.
---

# Example todos

The Exec Trace plugin keeps one todo list. The Example todos page in the BB sidebar and
the `bb exec-trace` command read and write the same list, so a change from either
side shows in the other at once.

## Commands

| Command | Effect |
| --- | --- |
| `bb exec-trace list` | Show every todo with its id. `[x]` marks a done todo. |
| `bb exec-trace add <title>` | Add a todo. Quote a title that has spaces. |
| `bb exec-trace done <todo-id>` | Mark a todo done. |
| `bb exec-trace undo <todo-id>` | Mark a todo not done. |
| `bb exec-trace remove <todo-id>` | Delete a todo. |

Add `--json` to any command when the output drives code.

## Procedure

1. Run `bb exec-trace list` before you change the list. Use the ids it prints;
   never guess an id.
2. Add todos one at a time with a short title that starts with a verb:
   `bb exec-trace add "Write the release notes"`.
3. When you finish a todo, mark it done: `bb exec-trace done <todo-id>`. Do not
   remove a todo to mark it done.
4. Remove a todo only when the user asks for it or when it duplicates
   another todo.
5. End with a short summary of what you added, completed, or removed.

## Rules

- Change the list only through `bb exec-trace`. Do not edit bb.db or the plugin's
  storage directly.
- A non-zero exit with "No todo with id" means the id is stale: run
  `bb exec-trace list` again.

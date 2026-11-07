---
name: handoff
description: Moves the current work into a fresh Claude Code session without losing anything. Use when the user types /handoff or says "new chat", "move this to a new session", "the chat is too long", or on your own when the context is getting full and the task is not finished.
---

# Handoff to a fresh session

Goal: the next session picks up exactly where this one stopped, and the user only pastes one message.

## 1. Write the handoff note

One note per task: `HANDOFF.md` in the task's working folder (the repo root if there is no narrower one). If it exists, update it; never start a second one. Keep only what is worth keeping, link to facts instead of copying them, and do not retell the conversation.

```markdown
# <task>

**Goal:** what "done" means for the whole task.

## Decisions
- <decision>: <why>, one line each.

## Done
- <result>, with paths, commits or URLs.

## State
- What is half-finished right now and where exactly it stopped.
- Uncommitted files, processes still running.

## Next
- [ ] The very next step, and how to tell it is done.

## Rejected
- <option>: <why>. So the next session does not offer it again.

## Checks
- The commands that prove it works: tests, build, preview.
```

## 2. Make sure nothing is lost

- Run `git status` in every repo you touched. Commit verified work if this project commits as it goes (stage the files you changed by name, never `git add -A`); otherwise list the uncommitted files under **State**.
- Background agents, dev servers or long commands you started and that are still running: wait for them, stop them, or note them under **State**. Leave alone anything you did not start.
- Anything that lives only in this chat (a pasted error, a decision the user gave in words, a reference link): put it in the note. Never copy secrets into it: replace tokens, keys, passwords and personal data with `<redacted>`.

## 3. Give one block to paste

```
Continue <task>. Before the first action read <full path to HANDOFF.md>.
Done: <1-3 lines>.
Next: <the concrete next step and how to tell it is done>.
Do not: <rejected options, if any>.
Working folder: <full path>.
```

The block must stand on its own: no "see above", nothing that only makes sense inside this chat. Long detail goes into the note, not into the block.

End the reply with exactly: `handoff: paste the block into a new session`. If the task is fully finished there is nothing to hand off: say so instead.

## When to run it without being asked

- The context is past about 60% and the task is not finished.
- A stage just finished and the next one is better started fresh.
- The topic changed while the context is already large.

Do not ask "shall we move?": write the note and give the block. If the task is the same and the context is still small, keep working in this session.

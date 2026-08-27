# Agent workflows

Skills for work in this repository that has a **right order**, where skipping a
step has a specific and expensive consequence.

| Skill | Use when |
|---|---|
| `write-adr` | Recording a decision that would be expensive to reverse |
| `add-table` | Adding or changing a database table — tenancy, policies, migration testing |
| `add-ui-component` | Adding an interface component or adapting a registry block |

## What belongs here

A skill earns its place when the sequence matters and the failure is quiet. All
three qualify: a table without policies leaks, a registry block dropped in
unadapted is unreachable or untranslated, a decision without a record gets
re-litigated every few months.

## What does not

General coding guidance — that is `docs/conventions/CODING_STANDARDS.md`.
Project context and binding rules — that is `CLAUDE.md`. A skill that restates
either is a third copy that will disagree with the other two.

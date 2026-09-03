# mdlinkcheck

A small CLI that finds broken relative links in Markdown files.

```bash
mdlinkcheck ./docs
mdlinkcheck ./docs --format json
```

Exits `1` when broken links are found, `0` when there are none, and `2` on a bad path —
so it drops into CI without extra glue.

## How this repository was built

Every line here was written by Claude Code running the
[Quartet](https://github.com/quintetkit/quartet) workflow: four personas
(Architect, Coder, Reviewer, Conflict Resolver) with responsibilities split
and permissions reduced.

**Do not take that on trust — read the history.**

- **Issues** — each one carries a `Scope`, `Depends on`, and acceptance criteria
  written before any code existed
- **Pull requests** — each maps to exactly one Issue and stays inside its declared scope
- **Timestamps** — Issues #2, #3 and #4 were implemented concurrently, in separate
  `git worktree` checkouts, and merged one at a time

Nothing in the history is cleaned up after the fact. Rejections and conflicts,
where they happened, are left in place: a history with no rejections would only
show that review was not doing anything.

## Status

Under construction. Follow the Issues.

## License

MIT

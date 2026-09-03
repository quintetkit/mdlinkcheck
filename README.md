# mdlinkcheck

A small CLI that finds broken relative links in Markdown files.

```bash
mdlinkcheck ./docs
mdlinkcheck ./docs --format json
```

```
docs/guide.md:3:36  ./vanished.md
index.md:3:38  ./nope.md

2 of 4 links broken in 2 files.
```

| Exit code | Meaning |
|---|---|
| `0` | No broken links |
| `1` | At least one broken link |
| `2` | The path could not be read |

## In CI

```yaml
- uses: quintetkit/mdlinkcheck@v1
  with:
    path: ./docs      # default: .
    format: text      # default: text
```

`v1` moves with the latest 1.x release. Pin an exact version — `@v1.0.0` — if you
would rather decide when to take a change.

The step fails when a link is broken. It is a composite action, not a Docker
one, so there is no image to build or pull.

This repository runs that action against itself on every push
([self-check.yml](.github/workflows/self-check.yml)), so "it works" is checked
rather than asserted.

`http:`, `https:`, `mailto:` and bare `#anchor` targets are reported as `external`
and never checked for existence — "not checked" has to stay distinguishable from
"broken". Links inside fenced or inline code are not extracted.

Reference-style links are checked too, including the collapsed and shortcut forms:

```markdown
[full][ref]      [collapsed][]      [shortcut]

[ref]: ./target.md
```

A reference with no matching definition is not a link at all — Markdown renders it
as plain text — so it is not reported as broken.

## Excluding paths

```bash
mdlinkcheck . --ignore 'generated/**' --ignore '**/CHANGELOG.md'
```

| Pattern | Matches |
|---|---|
| `*` | anything except `/` — `docs/*.md` stays inside `docs/` |
| `**` | anything, including `/` — `**/CHANGELOG.md` matches at any depth |
| `?` | a single character except `/` |

Excluded files are not counted in `checkedFiles`. `node_modules` and dot-directories
are skipped without asking.

## How this repository was built

Every line was written by Claude Code running the
[Quartet](https://github.com/quintetkit/quartet) workflow: four personas
(Architect, Coder, Reviewer, Conflict Resolver) with responsibilities split
and permissions reduced.

**Do not take that on trust. Read the history.**

| Issue | What | PR |
|---|---|---|
| [#1](https://github.com/quintetkit/mdlinkcheck/issues/1) | Types and the report schema | [#6](https://github.com/quintetkit/mdlinkcheck/pull/6) |
| [#2](https://github.com/quintetkit/mdlinkcheck/issues/2) | Link extraction and path resolution | [#9](https://github.com/quintetkit/mdlinkcheck/pull/9) |
| [#3](https://github.com/quintetkit/mdlinkcheck/issues/3) | Text reporter | [#8](https://github.com/quintetkit/mdlinkcheck/pull/8) |
| [#4](https://github.com/quintetkit/mdlinkcheck/issues/4) | JSON reporter | [#7](https://github.com/quintetkit/mdlinkcheck/pull/7) |
| [#5](https://github.com/quintetkit/mdlinkcheck/issues/5) | CLI entry point | [#12](https://github.com/quintetkit/mdlinkcheck/pull/12) |
| [#10](https://github.com/quintetkit/mdlinkcheck/issues/10) | Node type definitions | [#11](https://github.com/quintetkit/mdlinkcheck/pull/11) |

Every Issue carries a `Scope`, a `Depends on` line, and acceptance criteria,
all written before any code existed. Every PR maps to exactly one Issue and
stays inside its declared scope.

**Issues #2, #3 and #4 were implemented concurrently**, in three separate
`git worktree` checkouts, then merged one at a time. Implementation runs in
parallel; merging does not. Three PRs merged at once can each pass on their own
and still break together, and then you cannot tell which one did it.

## What went wrong, left in place

A history with no rejections would only prove that review was not doing anything.
Two things went wrong here, and both are still in the record.

**1. Two Issues declared a scope that did not exist.**
[#3](https://github.com/quintetkit/mdlinkcheck/issues/3) and [#4](https://github.com/quintetkit/mdlinkcheck/issues/4) named `test/reporters/` for their
tests, but this project keeps tests next to the code (`src/**/*.test.ts`) and has
no `test/` directory. Two Coders hit it independently and both reported it instead
of quietly picking a different path. The Architect corrected the Issues and
[left the reason as a comment](https://github.com/quintetkit/mdlinkcheck/issues/4#issuecomment-5530283597) rather than letting
the Coders absorb a planning mistake.

**2. `@types/node` was missing, so `tsc --noEmit` could not resolve `node:path`.**
The Coder on [#2](https://github.com/quintetkit/mdlinkcheck/issues/2) needed `package.json`, which was outside its
scope. It stopped and reported instead of editing the file. The Architect split
that out as [#10](https://github.com/quintetkit/mdlinkcheck/issues/10) and it was fixed in its own PR.

Both are the same mechanism: because a Coder cannot touch anything outside its
declared scope, a bad split has to surface instead of being papered over.

## Verification

```
tsc --noEmit    exit 0
vitest run      87 tests, 6 files, all passing
```

The CLI is run against this repository's own Markdown as a check.

## Development

```bash
npm install
npm test
npm run build
node bin/mdlinkcheck.js .
```

## License

MIT

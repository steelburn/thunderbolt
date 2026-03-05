# thunderbot

Reusable [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skills for development workflows. Use them as-is or customize them for your project.

## Quick Start

Run the setup script from your project root:

```bash
curl -fsSL https://raw.githubusercontent.com/thunderbird/thunderbot/main/setup.sh | bash
```

This adds thunderbot as a git subtree at `.thunderbot/`, creates symlinks into `.claude/commands/` and `.claude/agents/`, and adds a `thunderbot` git remote.

### Manual Install

If you prefer to do it yourself:

```bash
# Add the remote
git remote add thunderbot git@github.com:thunderbird/thunderbot.git

# Add as a subtree
git subtree add --prefix=.thunderbot thunderbot main --squash

# Create symlinks so Claude Code discovers the commands
mkdir -p .claude/commands .claude/agents
for f in .thunderbot/thunder*.md; do ln -sf "../../$f" ".claude/commands/$(basename $f)"; done
ln -sfn ../../.thunderbot/thunderbot .claude/commands/thunderbot
ln -sf ../../.thunderbot/thunderbot.md .claude/agents/thunderbot.md
```

Make sure `.claude/commands/` and `.claude/agents/` (and their contents) are not gitignored. If your `.gitignore` has `.claude/**`, add exceptions:

```gitignore
.claude/**
!.claude/commands/
!.claude/commands/**
!.claude/agents/
!.claude/agents/**
```

## Pull & Push

**Pull latest changes:**

```bash
git subtree pull --prefix=.thunderbot thunderbot main --squash
```

After pulling, re-run your symlink setup (the setup script creates a `make setup-symlinks` target for this).

**Push local edits back upstream:**

```bash
git subtree push --prefix=.thunderbot thunderbot main
```

## Customization

The symlinks in `.claude/commands/` point to `.thunderbot/`. To customize a command for your project only:

1. Delete the symlink
2. Copy the file from `.thunderbot/` into `.claude/commands/`
3. Edit freely — your version won't be overwritten by `subtree pull`

```bash
rm .claude/commands/thunderfix.md
cp .thunderbot/thunderfix.md .claude/commands/thunderfix.md
# now edit .claude/commands/thunderfix.md
```

To go back to the upstream version, re-create the symlink:

```bash
ln -sf ../../.thunderbot/thunderfix.md .claude/commands/thunderfix.md
```

## Skills

| Skill | Description |
|-------|-------------|
| `thunderbot` | Autonomous coding agent for Linear tasks |
| `thunderbot-daemon` | Background daemon that polls Linear for tasks |
| `thundercheck` | Run type-checking, linting, and format-checking |
| `thunderclean` | Remove build artifacts |
| `thunderdoctor` | Verify dev tools and environment |
| `thunderdown` | Stop docker containers |
| `thunderfeedback` | Submit feedback as GitHub issues |
| `thunderfix` | Fix PR issues and monitor until clean |
| `thunderimprove` | Review changed code for quality |
| `thunderin` | Enter a work context (worktree, deps, bootstrap) |
| `thunderout` | Leave worktree and return to main |
| `thunderpush` | Stage, commit, and push changes |
| `thundersync` | Sync skills with upstream thunderbot |
| `thunderup` | Bootstrap the dev environment |

## FAQ

**Q: Why `.thunderbot/` instead of directly in `.claude/commands/`?**

If the subtree lives at `.claude/commands/`, then *everything* in that directory is owned by the subtree. Any project-specific commands you add there get pushed to the thunderbot repo on `subtree push`. Using `.thunderbot/` as the subtree prefix keeps thunderbot files separate, and symlinks bridge them into `.claude/commands/` where Claude Code expects them.

**Q: Do I need to re-run symlink setup after pulling?**

Yes. If thunderbot adds a new command, you need new symlinks. Run your symlink setup after every pull. The setup script adds a `make setup-symlinks` target and wires it into `make thunderbot-pull` automatically.

**Q: Will `git clone` preserve the symlinks?**

Yes. Git tracks symlinks natively. Anyone who clones the repo gets working symlinks without running any setup.

**Q: Can I add my own commands alongside thunderbot's?**

Yes. Create `.md` files directly in `.claude/commands/` (not as symlinks). They're your project's files and won't interfere with the thunderbot subtree in `.thunderbot/`.

**Q: What if I customize a command and thunderbot updates it upstream?**

Your custom copy in `.claude/commands/` is a regular file, not a symlink — `subtree pull` updates `.thunderbot/` but won't touch your copy. You can diff the two versions and merge manually if you want the upstream changes.

**Q: How do I contribute a new skill back to thunderbot?**

Edit the file in `.thunderbot/`, commit, and push with `git subtree push --prefix=.thunderbot thunderbot main`. Or fork the thunderbot repo and open a PR.

# TriadJS Claude Code plugin

A [Claude Code](https://docs.anthropic.com/claude-code) plugin that teaches Claude how to build TypeScript backends with [TriadJS](https://github.com/justhamade/triad) — one declarative definition produces validation, types, OpenAPI, AsyncAPI, Gherkin, BDD tests, and Drizzle database schemas.

## What's in the plugin

### Skills

Progressive-disclosure knowledge modules. The top-level `using-triadjs` skill is the entry point; the focused sub-skills load on demand when the task touches their area.

| Skill | When Claude loads it |
|---|---|
| `using-triadjs` | Any mention of TriadJS, `@triadjs/*` packages, or the CLI. Pointer to every sub-skill, golden rules, minimal working example. |
| `triad-schema` | Designing `t.model`, `t.value`, primitives, collections, DDD entity/value-object choices, `.pick`/`.omit`/`.extend` derivations. |
| `triad-endpoint` | Declaring HTTP endpoints with `endpoint()`, wiring `request`/`responses`/`handler`/`beforeHandler`, router + bounded contexts. |
| `triad-channel` | Declaring WebSocket channels with `channel()`, typed state via the phantom witness, `broadcast`/`send`/`broadcastOthers`, first-message auth. |
| `triad-behaviors` | Writing `scenario().given().when().then()` chains. **Carries the authoritative assertion phrase table** — the parser is heuristic, so Claude reads this before writing a `then`. Also covers `scenario.auto()`. |
| `triad-testing` | Wiring `triad.config.ts`, `test-setup.ts`, per-scenario DB isolation, fixtures, and the runner loop. |
| `triad-adapters` | Mounting the router on Fastify, Express, or Hono. Raw-route escape hatches. |
| `triad-drizzle` | Generating Drizzle tables from `.storage()` hints, dialects (sqlite/postgres/mysql), `isUniqueViolation` pattern. |
| `triad-cli` | `triad test`, `triad docs`, `triad gherkin`, `triad db generate`, `triad validate`, `triad fuzz`. |
| `triad-services` | Module-augmenting `ServiceContainer`, DI factories, per-request services, repository pattern. |

### Slash commands

Task-oriented shortcuts that reference the skills.

| Command | What it does |
|---|---|
| `/triadjs:new` | Scaffold a new TriadJS project from scratch (schemas, endpoints, Fastify server, test config). |
| `/triadjs:model` | Add a new `t.model` or `t.value` plus derived DTOs. |
| `/triadjs:endpoint` | Add an HTTP endpoint with behaviors to an existing router. |
| `/triadjs:channel` | Add a WebSocket channel (Fastify only). |
| `/triadjs:scenario` | Add BDD behavior scenarios to an existing endpoint/channel using only valid parser phrases. |
| `/triadjs:test` | Run `triad test` and diagnose failures by category. |
| `/triadjs:docs` | Run `triad docs` and summarize the generated OpenAPI/AsyncAPI. |
| `/triadjs:validate` | Run `triad validate --strict` and fix consistency issues. |

## Installing the plugin

### Option 1: From the TriadJS marketplace (recommended)

The TriadJS repo doubles as a Claude Code marketplace — it hosts `.claude-plugin/marketplace.json` at the root, which points at this plugin. Add the marketplace once, then install the plugin from it:

```
/plugin marketplace add justhamade/triad
/plugin install triadjs@triadjs
```

Claude Code pulls the marketplace definition from the repo root and installs the `triadjs` plugin from `./plugin`. When a new version ships, `/plugin marketplace update triadjs` picks it up.

### Option 2: Local clone (for plugin development)

Clone this repo and symlink the plugin directory into your Claude plugins folder:

```bash
git clone https://github.com/justhamade/triad.git
cd triad
ln -s "$PWD/plugin" ~/.claude/plugins/triadjs
```

Then in a new Claude Code session the plugin's skills will be available and commands will show up as `/triadjs:*`. Edits to `plugin/skills/**` and `plugin/commands/**` are picked up on session restart.

### Option 3: Vendor into your own project

Copy the `plugin/` directory into your project's `.claude/plugins/triadjs/`. The skills and commands will be project-scoped — only this project's Claude Code sessions will see them. Use this when you want a pinned version checked in alongside your code.

## Using the plugin

Once installed, just describe what you want in plain English:

- *"Build a TriadJS backend for a bookstore with authors, books, and reviews"* → Claude invokes `/triadjs:new` and scaffolds the project.
- *"Add an endpoint for soft-deleting a book"* → `/triadjs:endpoint`.
- *"Write a scenario that covers the 409 duplicate-title case"* → `/triadjs:scenario`.
- *"Why is my test failing?"* → Claude reads the output and diagnoses using the `/triadjs:test` skill's category table.

Claude doesn't need to be told which skill to load — the `description` field on each skill tells Claude when it's relevant, and the top-level `using-triadjs` skill points at the others.

## The phrase table (why this matters)

TriadJS uses a **heuristic assertion parser**. Behaviors like `.then('response body has name "Buddy"')` are parsed into structured assertions by matching against a fixed set of phrases. Phrases that don't match any pattern fail at run time as `"Unrecognized assertion"` — Claude cannot silently paper over them.

The `triad-behaviors` skill carries the authoritative phrase table. Every time Claude writes a `then`, it pulls from that table rather than inventing phrasings. This is the single biggest productivity boost the plugin provides over an un-specialized Claude — it stops the "that looks like Triad" guessing loop that wastes iterations.

## Compatibility

- Tracks `@triadjs/core@^0.2.0` (the latest version on npm at the time of writing). The plugin's own version may run ahead of the published framework version; the `/triadjs:new` command runs `npm view @triadjs/core version` to pick the right range.
- Claude Code ≥ 1.0 (any version supporting the `.claude-plugin/plugin.json` format).
- Node ≥ 18 (for TriadJS itself).

## Contributing

The plugin lives inside the main TriadJS repo at `plugin/`. If you find a phrase, API, or workflow that's drifted between the framework and the skills, open a PR that updates both the source code and the relevant `SKILL.md`.

The `using-triadjs` skill's golden rules are the most load-bearing text — any change to the framework that invalidates one of them should update the skill in the same commit.

## License

[MIT](../LICENSE) — same as TriadJS.

# maintainerr_discord

A Discord bot that explains Maintainerr Test Media results.

Maintainerr's Test Media panel tells you whether an item matched a collection's
rules, but the raw output is a wall of JSON. Paste that output to this bot in a
DM and it replies with a readable breakdown: what each rule expected, what the
value actually was, and why the rule passed or failed.

## Using it

In a server where the bot is installed, run `/maintainerr bot`. The bot opens a
DM with instructions. From there:

1. On the Collections tab, open the collection in question.
2. Click Test Media.
3. Search for an item and click Test.
4. Copy the output with the orange clipboard icon.
5. Paste it into the DM.

It accepts the raw copy button output, or JSON or YAML in a code block. You can
paste as many results as you like in the same DM without starting a new session.

## Configuration

Copy `.env.example` to `.env` and fill it in.

| Variable           | Required | Purpose                                                                                                                                                      |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DISCORD_TOKEN`    | yes      | Bot token from the Discord developer portal. Anyone holding it controls the bot, so keep it out of version control.                                          |
| `LOG_LEVEL`        | no       | Minimum log level: debug (default), info, warn, error, or silent.                                                                                            |
| `DISCORD_GUILD_ID` | no       | Register the slash command in one guild instead of globally. Guild commands appear immediately, global ones can take up to an hour. Useful while developing. |

The bot needs the `applications.commands` scope and, in the bot settings, the
Guilds, Direct Messages, Guild Messages and Message Content intents. Enable the
privileged Message Content intent in the Discord developer portal.

## Running it

With podman:

```
podman run -d --name maintainerr_discord \
  -v maintainerr-discord-data:/data \
  -e DISCORD_TOKEN=your-token-here \
  ghcr.io/maintainerr/maintainerr_discord:latest
```

The image is OCI, so any runtime can pull it, but this project is podman-only:
it is built with buildah in CI and run under podman in production.

The bot shuts down on SIGTERM, so `podman stop` closes the Discord connection
cleanly rather than leaving the session hanging.

From source, with Node 26 or newer:

```
yarn install
cp .env.example .env   # then fill in DISCORD_TOKEN
yarn start
```

`yarn dev` runs the same thing under `node --watch`.

The `/data` volume is required. SQLite stores pending jobs and reports in
`/data/bot.sqlite`. Set `MAINTAINERR_DISCORD_DB=./data/bot.sqlite` when running from
source if `/data` is not writable. Stop the bot before copying the database for
backup so the WAL is checkpointed.

## Images

Pushes to `main` publish to `ghcr.io/maintainerr/maintainerr_discord`. Every
build is tagged twice: `latest`, and the full commit sha it was built from.
Deployments that want a fixed version should pin the sha tag, since `latest`
moves with every merge.

The package is public, so treat the image as world readable. Nothing secret
goes into it: no ENV secrets, no copied config, no `.env`. `DISCORD_TOKEN` is
injected at runtime by whatever runs the container, and only `package.json`,
`yarn.lock` and `src` are copied in.

## License

MIT. See [LICENSE](LICENSE).

## phase5 configuration

Add opt-in smarter decoding, threaded channel pastes, deterministic hints, generated Rules.mdx anchors and scoped screenshot extraction. Shared docs/provider code supports decoder features; no /ask command or report intake is registered. Prompts redact prefixed env credentials; retries share one daily unit.

Additional variables: `DISCORD_GUILD_ID`, `DISCORD_SUPPORT_CHANNEL_ID`, `DISCORD_TOKEN`, `DOCS_ORIGIN`, `DOCS_REF`, `DOCS_REPOSITORY`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LOG_LEVEL`, `MAINTAINERR_DISCORD_DB`

## phase6 configuration

Add feature-gated /ask, BM25 doc-link fallback, optional grounded completion, one opt-in support channel, user cooldowns and feedback escalation. Disabled /ask is removed without deleting unrelated commands.

Additional variables: `DISCORD_GUILD_ID`, `DISCORD_SUPPORT_CHANNEL_ID`, `DISCORD_TOKEN`, `DOCS_ORIGIN`, `DOCS_REF`, `DOCS_REPOSITORY`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LOG_LEVEL`, `MAINTAINERR_DISCORD_DB`

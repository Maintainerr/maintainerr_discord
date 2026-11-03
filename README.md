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

Copy `.env.example` to `.env` for local development. Inject secrets at runtime in
containers. `DISCORD_TOKEN` is the only required variable. Configuration errors
are reported together and do not print supplied values.

| Variable                      | Default                         | Purpose                                                                                            |
| ----------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`               | required                        | Discord bot token.                                                                                 |
| `DISCORD_GUILD_ID`            | empty                           | Register commands in this guild instead of globally.                                               |
| `MAINTAINERR_DISCORD_DB`      | `/data/bot.sqlite`              | SQLite file on persistent storage.                                                                 |
| `LOG_LEVEL`                   | `debug`                         | `debug`, `info`, `warn`, `error`, or `silent`.                                                     |
| `FEATURE_SMART_DECODER`       | `false`                         | Decode channel pastes in threads, add likely fixes and generated docs links in channels and DMs.   |
| `FEATURE_SCREENSHOTS`         | `false`                         | Transcribe Test Media screenshots, then run the ordinary formatter.                                |
| `FEATURE_SUPPORT`             | `false`                         | Register `/ask` and enable docs answering.                                                         |
| `FEATURE_REPORTS`             | `false`                         | Enable the report launcher, forum intake and staff review.                                         |
| `FEATURE_TRIAGE`              | `false`                         | Try docs answering for question reports before collecting files. Requires support and reports.     |
| `DISCORD_FORUM_CHANNEL_ID`    | empty                           | Reports forum. Required with reports.                                                              |
| `DISCORD_LAUNCHER_CHANNEL_ID` | empty                           | Report launcher text channel. Required with reports; same server as the forum.                     |
| `DISCORD_STAFF_ROLE_ID`       | empty                           | Role allowed to publish. Required with reports.                                                    |
| `DISCORD_SUPPORT_CHANNEL_ID`  | empty                           | Opt into automatic answers in exactly this one channel. Requires support; empty means `/ask` only. |
| `GITHUB_APP_ID`               | empty                           | GitHub App ID. Configure all three App credentials together.                                       |
| `GITHUB_INSTALLATION_ID`      | empty                           | App installation ID.                                                                               |
| `GITHUB_PRIVATE_KEY`          | empty                           | App PEM private key. Literal `\n` sequences are expanded into newlines. Secret.                    |
| `GITHUB_REPOSITORY`           | `Maintainerr/Maintainerr`       | Issue target as `owner/name`. Use a scratch repository for development.                            |
| `LLM_BASE_URL`                | empty                           | OpenAI-compatible server URL, optionally ending in `/v1`. Empty means docs links only.             |
| `LLM_API_KEY`                 | empty                           | Provider key if required. Secret.                                                                  |
| `LLM_MODEL`                   | empty                           | Model identifier. Required when a provider URL is set.                                             |
| `LLM_VISION`                  | `false`                         | Explicitly declare that the configured model accepts images.                                       |
| `LLM_REQUESTS_PER_MINUTE`     | `1`                             | Serial token-bucket rate. Set below the provider's published limit.                                |
| `LLM_DAILY_LIMIT`             | `100`                           | Maximum logical model requests per UTC day; retries share one unit. Persisted in SQLite.           |
| `DOCS_REPOSITORY`             | `Maintainerr/Maintainerr_docs`  | Documentation source as `owner/name`.                                                              |
| `DOCS_REF`                    | `main`                          | Documentation branch, tag, or commit. A refresh pins all files to one tree SHA.                    |
| `DOCS_ORIGIN`                 | `https://docs.maintainerr.info` | Published docs origin used for citations.                                                          |
| `ATTACHMENT_MAX_BYTES`        | `1048576`                       | Per-file cap for reports and screenshots. Reports allow at most ten files or pasted logs.          |

Boolean flags accept `true`, `false`, `1`, and `0`. All feature flags are off by
default. With just a token and writable storage, the bot preserves the original
DM decoder and logs that support, reports and screenshot reading are disabled.
It fetches documentation only when support or the smart decoder is enabled.

The bot needs the `applications.commands` scope and the Guilds, Direct Messages,
Guild Messages and Message Content intents. Enable the privileged Message Content
intent in the Discord developer portal. Grant View Channel, Send Messages,
Embed Links and Read Message History in the configured channels. Channel decoding
also needs Create Public Threads and Send Messages in Threads. Report collection
and GitHub state sync need Manage Threads and access to the configured forum.

## Optional capabilities

With `FEATURE_SMART_DECODER=true`, a recognized Test Media paste in a channel
gets its own thread; ordinary conversation is ignored. Deterministic guidance
covers empty watch dates, failed Radarr or Sonarr lookups, missing dates and
missing comparison values. The formatter stays unchanged. Rule links are built
from the headings, table labels and code identifiers in `Rules.mdx` at index time.
If an exact field is absent from the docs, the closest generated section is used.

With screenshots enabled, send an image in a DM, in the configured support
channel, or with an explicit bot mention. Images in other channels are ignored.
Image reading also needs `LLM_VISION=true` and a
configured vision provider. Without those, the bot asks for the copied text.
Malformed or incomplete model output also falls back to asking for text.

With `FEATURE_SUPPORT=true`, `/ask question:...` returns the three closest docs
sections. This mode works without a provider and should be observed before
configuring one. Provider failure, quota exhaustion, or invalid citations fall
back to docs links. The index refreshes at boot; a failed refresh keeps the last
complete index. A fresh installation without an index asks for a maintainer if
its first refresh fails. Questions have a 30 second per-user cooldown and each
message is answered at most once. Auto answering is off until a support channel
is explicitly configured. "This Did Not Help" opens the report category selector
when reports are enabled, otherwise it refers to a maintainer.

With `FEATURE_REPORTS=true`, the bot maintains one persistent launcher, collects
a category and details, and creates a forum post immediately. The reporter can
add raster images or small text logs, finish with Done or No Files, edit, or
cancel. Submissions are limited to three per hour with a 30 second cooldown.
Unsupported files, oversized files and binary files disguised as text are rejected.
Text is redacted before SQLite storage and again before GitHub publication.

Without GitHub App credentials, reports stay in Discord. With credentials, a
member with the staff role can open Staff Actions and see an ephemeral Publish
button. Discord cannot hide individual buttons by role in a shared message;
both opening that private menu and publishing re-fetch and check the staff role.
Nothing publishes automatically. The App needs Issues read/write and Metadata
read permissions. No inbound port, webhook URL, webhook secret, or personal
access token is used. Issues receive `source:discord` and their category label.
Replies and state are synced every 60 seconds; labels map to matching forum tags.
Files remain in Discord, with the issue linking back to the thread. Human replies
reopen closed issues and archived threads. Idempotency markers and persisted job
leases recover interrupted publication and relay operations.

`FEATURE_TRIAGE=true` makes question reports try documentation first. A reporter
can mark the question solved, in which case no issue is queued, or continue into
file collection. Leave this flag disabled until docs answering has been observed
on real questions for several weeks.

Use a free-tier or self-hosted provider; no provider is selected by default.
Text prompts are redacted and retrieval is limited to three short sections.
Screenshot pixels cannot be text-redacted, so screenshot reading is separately
opted into. Quotas and provider failures never disable the deterministic decoder.

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
MAINTAINERR_DISCORD_DB=./data/bot.sqlite yarn start
```

`yarn dev` runs the same thing under `node --watch`.

The `/data` volume is required. SQLite stores reports, pending jobs and the docs
index in `/data/bot.sqlite`; replacing a container without its volume loses them.
`MAINTAINERR_DISCORD_DB` overrides the path. From source, set it to
`./data/bot.sqlite` if `/data` is not writable. Stop the bot before copying the
database for a backup, so the WAL has been checkpointed.

## Images

Pushes to `main` publish to `ghcr.io/maintainerr/maintainerr_discord`. Every
build is tagged twice: `latest`, and the full commit sha it was built from.
Deployments that want a fixed version should pin the sha tag, since `latest`
moves with every merge.

The package is public, so treat the image as world readable. Nothing secret
goes into it: no ENV secrets, no copied config, no `.env`. `DISCORD_TOKEN` is
injected at runtime by whatever runs the container, and only `package.json`,
`yarn.lock` and `src` are copied in.

## Development and acceptance

Run `yarn test` with Node 26. Tests use the standard library and fake services;
they never write to the production tracker. `yarn format` runs pinned Prettier
on demand with `npx`; it adds no runtime dependency. Prettier 3.6.2 is selected
by the script, not pinned in yarn.lock. A cold cache needs npm registry access;
offline formatting requires an already populated cache. Legacy formatter files and
their existing tests are excluded from formatting to preserve their original
content except for moved import paths. Pull requests run `node --test` and build
and syntax-check the image. The Dependabot workflows are unchanged.

Live integration requires the maintainer-owned setup from phase 0 of `PLAN.md`:
a test guild, report channels and staff role, and a GitHub App installed on a
scratch repository. Set `GITHUB_REPOSITORY` to that scratch repository before
running integration checks. Do not test publication on `Maintainerr/Maintainerr`.
Check the DM output against a saved payload, restart during collection and
publication, race Publish, and verify that replies do not loop, closing archives
the thread, replying reopens both sides, and unchanged polls return 304.
`AUDIT.log` records implementation and validation, including outstanding live
acceptance. No claim of production validation or multi-week observation is made.

## License

MIT. See [LICENSE](LICENSE).

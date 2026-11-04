# maintainerr_discord

The Maintainerr Discord bot. It answers support questions from the
documentation, explains Test Media results, sends bug reports to GitHub and
welcomes new members.

## Using it

In the support forums:

- Open a post with your question. The bot replies once with the closest
  documentation sections. It reads the post's title and its first message.
- Paste your Test Media output in a post, on its own or after a sentence, and the
  bot explains which rules matched and why. A result too long for one message,
  which Discord turns into an attached file, works too.

Anywhere in the server:

- `/ask` searches the documentation for your question.
- `/testmedia` opens a private DM where you can paste results, as many as you
  like, without starting a new session.
- `/help` lists everything the bot can do, with links to the documentation.
- `/delete` explains when Maintainerr takes action on your media. The answer is
  public, so you can post it in someone's thread.

To report a bug, press **Report a Bug** in the bug report channel. A maintainer
reviews each report before it goes to GitHub. Feature ideas go to
https://features.maintainerr.info/.

To get your Test Media output:

1. On the Collections tab, open the collection in question.
2. Click Test Media.
3. Search for an item and click Test.
4. Copy the output with the orange clipboard icon.

The bot accepts the raw copy button output, or JSON or YAML in a code block.

## Features

Every feature is off by default. With only a token, the bot answers `/testmedia`,
`/help` and `/delete`, and decodes Test Media pastes sent to it in a DM.

- **Support** (`FEATURE_SUPPORT`): answers each new post in the support forums
  once, and `/ask` anywhere, with the three closest documentation sections.
  "This Did Not Help" thanks the member, offers Report a Bug when reports are on,
  and pings `DISCORD_SUPPORT_ROLE_ID` once per answer in the support channels.
- **Smart decoder** (`FEATURE_SMART_DECODER`): decodes Test Media pastes in the
  support channels, and adds likely fixes and rule documentation links to every
  breakdown.
- **Bug reports** (`FEATURE_REPORTS`): a launcher sends feature ideas to the
  feature board and questions to the support forums. A bug opens a form and a
  post in the reports forum, where the reporter adds files and presses Done. A
  member with the staff role publishes it to GitHub. Replies sync both ways,
  GitHub is checked every 60 seconds, and issue labels show as matching forum
  tags.
- **Welcome** (`FEATURE_WELCOME`): greets each new member in the welcome channel
  and, with `DISCORD_WELCOME_ROLE_ID`, gives them that role once they have
  accepted the server rules.
- **Screenshots** (`FEATURE_SCREENSHOTS`): reads Test Media screenshots. Needs a
  model with `LLM_VISION=true`; without one the bot asks for the copied text.

A model is optional. Without one, answers are documentation links. Free tiers
may keep prompts to train their models, and support questions contain logs and
paths, so check the provider's terms or run a model yourself.

Reports are tied to the GitHub repository they were first published to. To
switch `GITHUB_REPOSITORY`, start with a fresh database.

## Setup

Create a bot with the `applications.commands` scope. Enable the Message Content
intent, and the Server Members intent if welcome is on. In the channels the bot
uses, grant View Channel, Send Messages, Embed Links and Read Message History,
plus Create Public Threads, Send Messages in Threads and Manage Threads for
decoding and reports. Giving the welcome role needs Manage Roles, with the bot's
role above it.

Keep the support and staff roles unmentionable. Grant the bot Mention Everyone
only in the support channels, reports forum and launcher channel where it sends
role notifications.

The GitHub App needs Issues read and write, and Metadata read. No webhook or
inbound port is used.

`DISCORD_TOKEN` is the only required variable. Flags accept `true`, `false`, `1`
and `0`. Configuration errors are listed together, without echoing values.

| Variable                      | Default                         | Purpose                                                                 |
| ----------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| `DISCORD_TOKEN`               | required                        | Bot token. Secret.                                                      |
| `DISCORD_GUILD_ID`            | empty                           | Register commands in this server only, and remove global copies.        |
| `MAINTAINERR_DISCORD_DB`      | `/data/bot.sqlite`              | SQLite file on persistent storage.                                      |
| `LOG_LEVEL`                   | `debug`                         | `debug`, `info`, `warn`, `error` or `silent`.                           |
| `FEATURE_SUPPORT`             | `false`                         | Documentation answers and `/ask`.                                       |
| `FEATURE_SMART_DECODER`       | `false`                         | Decode pastes in the support channels.                                  |
| `FEATURE_REPORTS`             | `false`                         | Bug reports and GitHub publishing.                                      |
| `FEATURE_WELCOME`             | `false`                         | Welcome new members.                                                    |
| `FEATURE_SCREENSHOTS`         | `false`                         | Read Test Media screenshots.                                            |
| `DISCORD_SUPPORT_CHANNEL_IDS` | empty                           | Comma-separated support channels or forums.                             |
| `DISCORD_SUPPORT_ROLE_ID`     | empty                           | Role pinged when an answer did not help. Keep unmentionable.            |
| `DISCORD_FORUM_CHANNEL_ID`    | empty                           | Reports forum. Required with reports.                                   |
| `DISCORD_LAUNCHER_CHANNEL_ID` | empty                           | Text channel for the Report a Bug launcher. Required with reports.      |
| `DISCORD_STAFF_ROLE_ID`       | empty                           | Role allowed to publish reports. Required with reports.                 |
| `DISCORD_WELCOME_CHANNEL_ID`  | empty                           | Welcome channel. Required with welcome.                                 |
| `DISCORD_WELCOME_ROLE_ID`     | empty                           | Role given to new members.                                              |
| `GITHUB_APP_ID`               | empty                           | GitHub App ID. Set all three App values together.                       |
| `GITHUB_INSTALLATION_ID`      | empty                           | App installation ID.                                                    |
| `GITHUB_PRIVATE_KEY`          | empty                           | App private key in PEM format; literal `\n` becomes a newline. Secret.  |
| `GITHUB_REPOSITORY`           | empty                           | Issue repository as `owner/name`. Required with reports.                |
| `LLM_BASE_URL`                | empty                           | OpenAI-compatible provider URL. Empty means documentation links only.   |
| `LLM_API_KEY`                 | empty                           | Provider key, if needed. Secret.                                        |
| `LLM_MODEL`                   | empty                           | Model name. Required with a provider URL.                               |
| `LLM_VISION`                  | `false`                         | The model accepts images.                                               |
| `LLM_REQUESTS_PER_MINUTE`     | `1`                             | Request rate. Keep it below the provider's limit.                       |
| `LLM_DAILY_LIMIT`             | `100`                           | Model requests per UTC day.                                             |
| `DOCS_REPOSITORY`             | `Maintainerr/Maintainerr_docs`  | Documentation source as `owner/name`.                                   |
| `DOCS_REF`                    | `main`                          | Documentation branch, tag or commit.                                    |
| `DOCS_ORIGIN`                 | `https://docs.maintainerr.info` | Published documentation site used in links.                             |
| `ATTACHMENT_MAX_BYTES`        | `1048576`                       | Largest accepted file. A report holds at most ten files or pasted logs. |

## Running it

```
podman run -d --name maintainerr_discord \
  -v maintainerr-discord-data:/data \
  -e DISCORD_TOKEN=your-token-here \
  ghcr.io/maintainerr/maintainerr_discord:latest
```

Keep the `/data` volume: it holds reports, pending GitHub jobs and the
documentation index. Stop the bot before copying the database.

From source, with Node 26:

```
yarn install
cp .env.example .env   # then fill in DISCORD_TOKEN
MAINTAINERR_DISCORD_DB=./data/bot.sqlite yarn start
```

Every push to `main` publishes the image tagged `latest` and `sha-<commit>`. Pin
the sha tag for a fixed version. The image is public and contains no secrets.

## Development

`yarn test` runs the tests with fake services; they never touch a real tracker.
`yarn format` runs Prettier. Pull requests also build the image and syntax-check
it. Test live publishing against a scratch repository, never against
`Maintainerr/Maintainerr`.

## License

MIT. See [LICENSE](LICENSE).

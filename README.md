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

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token from the Discord developer portal. Anyone holding it controls the bot, so keep it out of version control. |
| `DISCORD_GUILD_ID` | no | Register the slash command in one guild instead of globally. Guild commands appear immediately, global ones can take up to an hour. Useful while developing. |

The bot needs the `applications.commands` scope and, in the bot settings, the
Guilds and Direct Messages intents.

## Running it

With Docker:

```
docker run -d --name maintainerr_discord \
  -e DISCORD_TOKEN=your-token-here \
  ghcr.io/maintainerr/maintainerr_discord:latest
```

From source, with Node 26 or newer:

```
yarn install
cp .env.example .env   # then fill in DISCORD_TOKEN
yarn start
```

`yarn dev` runs the same thing under `node --watch`.

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

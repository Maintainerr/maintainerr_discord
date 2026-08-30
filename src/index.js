import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js'
import { config } from 'dotenv'
import { parse as parseYaml } from 'yaml'
import { formatMaintainerrResult } from './formatter.js'

config()

if (!process.env.DISCORD_TOKEN) {
  console.error(
    'ERROR: DISCORD_TOKEN is not set. Copy .env.example to .env and fill it in.'
  )
  process.exit(1)
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
})

const commandData = [
  new SlashCommandBuilder()
    .setName('maintainerr')
    .setDescription('Maintainerr Discord tools.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('bot')
        .setDescription(
          'Open a DM session to decode Maintainerr Test Media results.'
        )
    )
    .toJSON(),
]

function parseMaintainerrPayload(rawText) {
  try {
    return JSON.parse(rawText)
  } catch {
    return parseYaml(rawText)
  }
}

async function registerCommands() {
  if (!client.application) return

  if (process.env.DISCORD_GUILD_ID) {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID)
    await upsertCommands(guild.commands, commandData)
    console.log(
      `Registered slash commands in guild ${guild.name} (${guild.id}).`
    )
    return
  }

  await upsertCommands(client.application.commands, commandData)
  console.log('Registered global slash commands.')
}

async function upsertCommands(commandManager, commands) {
  const existing = await commandManager.fetch()

  for (const command of commands) {
    const current = existing.find((item) => item.name === command.name)
    if (current) {
      await commandManager.edit(current.id, command)
    } else {
      await commandManager.create(command)
    }
  }
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`)
  await registerCommands()
})

client.on('messageCreate', async (message) => {
  if (message.author.bot) return

  if (message.channel.type === ChannelType.DM) {
    await handleDM(message)
  }
})

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName !== 'maintainerr') return
  if (interaction.options.getSubcommand() !== 'bot') return

  console.log(
    `[slash] /maintainerr bot used by ${interaction.user.tag} in ${
      interaction.guild?.name ?? 'DM'
    }`
  )

  await handleSlashCommand(interaction)
})

// discord.js puts the full request URL on its REST errors (DiscordAPIError.url
// and HTTPError.url, both unredacted), and Discord embeds the interaction token
// directly in those paths:
//   /interactions/{interaction.id}/{interaction.token}/callback
//   /webhooks/{application.id}/{interaction.token}/messages/{message.id}
// That token stays usable for 15 minutes, so it must never reach a log file.
// Bounded and anchored on purpose: one pass, no nested quantifiers.
const redactTokens = (text) =>
  String(text).replace(
    /\/(interactions|webhooks)\/(\d{1,20})\/[^/?#\s]+/g,
    '/$1/$2/[redacted]'
  )

// Log shape for anything that might be a discord.js REST error: keep what is
// worth diagnosing, drop the credential. Errors without an own url are scrubbed
// rather than passed through, because a failed request can surface as a plain
// Error carrying the same token in its message, its stack, or a nested cause.
// requestBody is deliberately absent: it holds the user's pasted DM content.
function describeError(err, depth = 0) {
  if (typeof err === 'string') return redactTokens(err)
  if (!err || typeof err !== 'object') return err
  // Cause chains can be cyclic, and a truncation marker beats recursing forever.
  if (depth > 3) return '[cause chain truncated]'

  const described = {
    name: err.name,
    message: typeof err.message === 'string' ? redactTokens(err.message) : err.message,
    code: err.code,
    status: err.status,
    method: err.method,
    stack: typeof err.stack === 'string' ? redactTokens(err.stack) : undefined,
  }

  if ('url' in err) described.url = redactTokens(err.url)
  if (err.cause) described.cause = describeError(err.cause, depth + 1)

  return described
}

client.on('error', (err) =>
  console.error('Discord client error:', describeError(err))
)
process.on('unhandledRejection', (err) =>
  console.error('Unhandled rejection:', describeError(err))
)

// Discord's API error for "Cannot send messages to this user", which is what
// a user who blocks DMs from server members produces. Any other failure is
// ours, so don't blame their privacy settings for it.
const CANNOT_SEND_DM = 50007

async function handleSlashCommand(interaction) {
  // Discord expects an initial response within 3 seconds or it shows the user
  // "The application did not respond" and invalidates the interaction token.
  // Opening a DM and sending the instructions is two API round-trips, which
  // regularly overruns that budget: the DM arrives but the acknowledgement is
  // already too late. Defer first, which buys 15 minutes, then do the work.
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  } catch (err) {
    // Nothing left to reply with if even the deferral missed the window.
    console.error('handleSlashCommand could not defer:', describeError(err))
    return
  }

  try {
    const dm = await interaction.user.createDM()
    await dm.send(
      "I'm the Maintainerr Test Results Bot.\n\n" +
        "Paste the output from Maintainerr's Test Media copy button and I'll explain why the media matched or did not match.\n\n" +
        'How to get it:\n' +
        '1. On the Collections tab, open the collection in question\n' +
        '2. Click Test Media\n' +
        '3. Search for an item and click Test\n' +
        '4. Copy the output using the orange clipboard icon.\n' +
        '5. Paste it here and send the message.\n\n' +
        'You can paste another result here any time without having to start a new session.\n'
    )

    await interaction.editReply({
      content: "Check your DMs. I'll decode your Maintainerr test result there.",
    })
  } catch (err) {
    console.error('handleSlashCommand error:', describeError(err))

    const content =
      err?.code === CANNOT_SEND_DM
        ? "I couldn't send you a DM. Make sure your privacy settings allow DMs from members of this server."
        : 'Something went wrong opening your DM. Please try again in a moment.'

    try {
      await interaction.editReply({ content })
    } catch (replyErr) {
      console.error('handleSlashCommand could not report failure:', describeError(replyErr))
    }
  }
}

async function handleDM(message) {
  const content = message.content.trim()

  if (content.toLowerCase() === 'done') {
    await message.reply(
      'There is no active session to close. You can paste another Maintainerr test result here any time.'
    )
    return
  }

  let rawPayload = content
  const fenceMatch = rawPayload.match(
    /^```(?:json|yaml|yml)?\s*([\s\S]*?)```$/i
  )
  if (fenceMatch) {
    rawPayload = fenceMatch[1].trim()
  }

  let parsed
  try {
    parsed = parseMaintainerrPayload(rawPayload)
  } catch {
    await message.reply(
      "I couldn't parse that payload.\n\n" +
        "Paste the output copied directly from Maintainerr's Test Media panel, or use `/maintainerr bot` in a server if you want the instructions again. " +
        'I accept either the raw copy-button output or JSON in a code block.'
    )
    return
  }

  let formatted
  try {
    formatted = formatMaintainerrResult(parsed)
  } catch (err) {
    await message.reply(
      `Couldn't interpret this payload:\n> ${err.message}\n\n` +
        "Make sure it's the output from Maintainerr's Test Media feature."
    )
    return
  }

  if (formatted.type === 'error' || formatted.type === 'empty') {
    await message.reply(formatted.message)
  } else {
    for (const item of formatted.items) {
      const embeds = buildResultEmbeds(item)
      for (const embed of embeds) {
        await message.channel.send({ embeds: [embed] })
      }
    }

    await message.channel.send(
      'Paste another test result any time to analyze more.'
    )
  }
}

function buildResultEmbeds(item) {
  const color = item.result === 'Matched' ? 0x2b8a3e : 0xf08c00
  const embeds = []

  const summaryEmbed = new EmbedBuilder()
    .setColor(color)
    .setTitle('Maintainerr Test Result')
    .addFields(
      { name: 'Overall Result', value: item.result, inline: true },
      {
        name: 'Media Server ID',
        value: `\`${item.mediaServerId}\``,
        inline: true,
      },
      { name: 'Final Explanation', value: item.finalExplanation }
    )

  for (const [index, chunk] of chunkText(item.ruleGroup, 1024).entries()) {
    summaryEmbed.addFields({
      name: index === 0 ? 'Rule Group' : 'Rule Group (cont.)',
      value: chunk,
    })
  }

  embeds.push(summaryEmbed)

  for (const section of item.sections) {
    const blocks = []

    if (section.operator) {
      blocks.push(`**Section Operator:** ${section.operator}`)
    }

    for (let i = 0; i < section.rules.length; i += 1) {
      const rule = section.rules[i]
      const blockLines = []

      if (i > 0 && rule.operator) {
        blockLines.push(`**Rule Operator:** ${rule.operator}`)
        blockLines.push('')
      }

      blockLines.push(`**Rule ${i + 1}**`)
      blockLines.push(rule.summary)
      blockLines.push('')
      blockLines.push(`**Expected:** ${rule.expectation}`)
      blockLines.push('')

      for (const value of rule.values) {
        blockLines.push(`**${value.label}:** ${value.value}`)
      }

      blockLines.push(`**Result:** ${rule.result}`)
      blockLines.push(`**Why:** ${rule.why}`)

      blocks.push(blockLines.join('\n'))
    }

    const descriptions = chunkBlocks(blocks, 4096)

    for (const [index, description] of descriptions.entries()) {
      embeds.push(
        new EmbedBuilder()
        .setColor(color)
          .setTitle(
            index === 0
              ? `${section.title} • ${section.result}`
              : `${section.title} • ${section.result} (cont.)`
          )
          .setDescription(
            description || 'No rule details were returned for this section.'
          )
      )
    }
  }

  return embeds
}

function chunkText(text, maxLength) {
  if (text.length <= maxLength) return [text]

  const chunks = []
  let remaining = text

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf(' ', maxLength)
    if (splitIndex <= 0) splitIndex = maxLength
    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).trimStart()
  }

  if (remaining) chunks.push(remaining)
  return chunks
}

function chunkBlocks(blocks, maxLength) {
  const chunks = []
  let current = ''

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block
    if (candidate.length <= maxLength) {
      current = candidate
      continue
    }

    if (current) {
      chunks.push(current)
      current = ''
    }

    if (block.length <= maxLength) {
      current = block
      continue
    }

    const blockChunks = chunkText(block, maxLength)
    chunks.push(...blockChunks.slice(0, -1))
    current = blockChunks.at(-1) ?? ''
  }

  if (current) chunks.push(current)
  return chunks
}

client.login(process.env.DISCORD_TOKEN)

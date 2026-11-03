import { MessageFlags } from 'discord.js'
import { parse as parseYaml } from 'yaml'
import { formatMaintainerrResult } from './formatter.js'
import { buildResultEmbeds } from './embeds.js'
import { describeError } from '../../lib/logging.js'

const CANNOT_SEND_DM = 50007

function parseMaintainerrPayload(rawText) {
  try {
    return JSON.parse(rawText)
  } catch {
    return parseYaml(rawText)
  }
}

export async function handleBotCommand(interaction, { logger }) {
  logger.debug(
    `[slash] /maintainerr bot used by ${interaction.user.tag} in ${interaction.guild?.name ?? 'DM'}`
  )
  // Discord expects an initial response within 3 seconds or it shows the user
  // "The application did not respond" and invalidates the interaction token.
  // Opening a DM and sending the instructions is two API round-trips, which
  // regularly overruns that budget: the DM arrives but the acknowledgement is
  // already too late. Defer first, which buys 15 minutes, then do the work.
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  } catch (err) {
    // Nothing left to reply with if even the deferral missed the window.
    logger.error('handleSlashCommand could not defer:', describeError(err))
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
      content:
        "Check your DMs. I'll decode your Maintainerr test result there.",
    })
  } catch (err) {
    logger.error('handleSlashCommand error:', describeError(err))

    const content =
      err?.code === CANNOT_SEND_DM
        ? "I couldn't send you a DM. Make sure your privacy settings allow DMs from members of this server."
        : 'Something went wrong opening your DM. Please try again in a moment.'

    try {
      await interaction.editReply({ content })
    } catch (replyErr) {
      logger.error(
        'handleSlashCommand could not report failure:',
        describeError(replyErr)
      )
    }
  }
}

export async function handleDM(message) {
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

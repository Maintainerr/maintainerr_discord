import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js'
import { safeMessage } from '../../lib/http.js'
import { where } from '../../lib/logging.js'
import { GUIDE_URL, supportLines } from '../welcome/index.js'

const DOCS = [
  ['Installation', 'installation'],
  ['Rule Glossary', 'glossary'],
  ['Configuration', 'configuration'],
  ['Rules', 'rules'],
  ['Collections', 'collections'],
]

const deleteText = (config) => `**Will Maintainerr Delete My Media?**
Not right away. Rules never delete anything by themselves: they add matching media to a collection. Maintainerr takes the action you chose, such as deleting, once an item has been in that collection for the number of days set in **Take action after days**. Use 30 days or more until you have checked that the collection holds what you expect.

How it works: ${config.docsOrigin}/works/#take-action-after-days`

const log = (interaction, ctx) =>
  ctx.logger.debug(
    `[${interaction.commandName}] ${interaction.user.tag} in ${where(interaction)}`
  )

// Public, so a helper can post it in someone's thread.
export async function handleDelete(interaction, ctx) {
  log(interaction, ctx)
  await interaction.reply(safeMessage(deleteText(ctx.config)))
}

export async function handleHelp(interaction, ctx) {
  log(interaction, ctx)
  const commands = ctx.commands
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((command) => `- \`/${command.name}\` - ${command.description}`)
  await interaction.reply({
    ...safeMessage(
      [
        '**Maintainerr Bot**',
        ...supportLines(ctx.config),
        ...commands,
        '',
        `How to use the bot: ${GUIDE_URL}`,
      ].join('\n')
    ),
    flags: MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds,
    components: [
      new ActionRowBuilder().addComponents(
        DOCS.map(([label, path]) =>
          new ButtonBuilder()
            .setLabel(label)
            .setStyle(ButtonStyle.Link)
            .setURL(`${ctx.config.docsOrigin}/${path}/`)
        )
      ),
    ],
  })
}

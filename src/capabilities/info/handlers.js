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

const unraidText = () => `**Unraid: Upgrading to v2.0.0**
Older Unraid templates need these changes for Maintainerr v2.0.0 and later.
1. Open the Unraid terminal, the \`>_\` symbol at the top right.
2. Run \`chown -R 1000:1000 /mnt/user/appdata/<maintainerr config folder>\`.
3. In the Docker tab, edit the Maintainerr template.
4. Remove the "WebUI" configuration completely.
5. Select "Add another Path, Port, Variable, Label or Device" and set:
   - Config Type: Port
   - Name: WebUI
   - Container Port: 6246
   - Host Port: your custom port, or leave 6246
   - Connection Type: TCP
6. Select Save.
7. At the top right of the template, change "Basic View" to "Advanced View".
8. Change \`WebUI: http://[IP]:[PORT:80]\` to \`WebUI: http://[IP]:[PORT:6246]\`.`

const log = (interaction, ctx) =>
  ctx.logger.debug(
    `[${interaction.commandName}] ${interaction.user.tag} in ${where(interaction)}`
  )

// Shared answers are public, so a helper can post one in someone's thread.
const answer = (render) => async (interaction, ctx) => {
  log(interaction, ctx)
  await interaction.reply(safeMessage(render(ctx.config)))
}
export const handleDelete = answer(deleteText)
export const handleUnraid = answer(unraidText)

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

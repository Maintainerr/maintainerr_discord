import { EmbedBuilder } from 'discord.js'
import { chunkText, chunkBlocks } from '../../lib/chunking.js'

export function buildResultEmbeds(item) {
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

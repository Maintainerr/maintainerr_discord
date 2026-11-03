export function chunkText(text, maxLength) {
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

export function chunkBlocks(blocks, maxLength) {
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

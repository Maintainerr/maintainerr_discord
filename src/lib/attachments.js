import { readLimited } from './http.js'
import { isUtf8 } from 'node:buffer'

const imageTypes = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
])
const textExtensions = new Set([
  'txt',
  'log',
  'json',
  'yaml',
  'yml',
  'md',
  'csv',
])

export function classifyAttachment(attachment, maxBytes) {
  if (
    !Number.isSafeInteger(attachment.size) ||
    attachment.size < 1 ||
    attachment.size > maxBytes
  ) {
    return { error: `Files must be between 1 and ${maxBytes} bytes.` }
  }
  const extension = attachment.name?.split('.').at(-1).toLowerCase()
  const type = attachment.contentType?.split(';')[0].toLowerCase()
  if (imageTypes.get(extension) === type) return { kind: 'image', type }
  if (
    textExtensions.has(extension) &&
    (type?.startsWith('text/') ||
      ['application/json', 'application/yaml', 'application/x-yaml'].includes(
        type
      ))
  )
    return { kind: 'text', type }
  return {
    error:
      'Only PNG, JPEG, GIF, WebP images and small text or log files are accepted. Archives and other files are not accepted.',
  }
}

export async function downloadAttachment(
  attachment,
  maxBytes,
  fetchFn = fetch
) {
  const classification = classifyAttachment(attachment, maxBytes)
  if (classification.error) throw new Error(classification.error)
  const url = new URL(attachment.url)
  if (
    url.protocol !== 'https:' ||
    !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)
  )
    throw new Error('Attachments must use Discord hosting.')
  const response = await fetchFn(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok)
    throw new Error(`Attachment download returned HTTP ${response.status}.`)
  const bytes = await readLimited(response, maxBytes)
  if (!bytes.length) throw new Error('Empty files are not accepted.')
  const filePrefix = bytes.subarray(0, 4).toString()
  const signatures = {
    'image/png': bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/jpeg': bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    'image/gif': ['GIF87a', 'GIF89a'].includes(
      bytes.subarray(0, 6).toString('ascii')
    ),
    'image/webp':
      filePrefix === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
  }
  if (classification.kind === 'image' && !signatures[classification.type])
    throw new Error('The file content does not match its image type.')
  if (
    classification.kind === 'text' &&
    (!isUtf8(bytes) ||
      bytes.includes(0) ||
      ['PK', 'MZ', 'Rar!', '7z'].some((prefix) =>
        filePrefix.startsWith(prefix)
      ) ||
      (bytes[0] === 31 && bytes[1] === 139))
  )
    throw new Error(
      'This file contains binary data. Copy the log into a plain text file instead.'
    )
  return { ...classification, bytes }
}

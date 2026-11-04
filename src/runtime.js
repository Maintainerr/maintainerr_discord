import { openDatabase } from './db.js'
import { createDocsIndex, refreshDocs } from './capabilities/support/docs.js'
import { createProvider } from './llm/provider.js'
import { createAnswerer } from './capabilities/support/answer.js'
import { describeError } from './lib/logging.js'

export async function createContext(config, logger) {
  const store = openDatabase(config.dbPath)
  const ctx = { config, logger, store, cleanup: [] }
  ctx.cleanup.push(() => store.close())
  ctx.docs = createDocsIndex(store)
  ctx.provider = createProvider(config, store)
  ctx.answer = createAnswerer(ctx)
  if (config.featureSupport || config.featureSmartDecoder) {
    let active
    const refresh = () => {
      if (active) return active
      active = (async () => {
        try {
          logger.debug(
            `Indexed ${await refreshDocs(ctx.docs, config)} documentation chunks.`
          )
        } catch (err) {
          logger.warn(
            'Documentation refresh failed. Check network access; the previous index will be used.'
          )
          logger.debug(describeError(err))
        }
      })().finally(() => {
        active = null
      })
      return active
    }
    await refresh()
    const timer = setInterval(refresh, 24 * 60 * 60 * 1000)
    timer.unref()
    ctx.cleanup.push(async () => {
      clearInterval(timer)
      // Finish indexing before the SQLite connection closes.
      await active
    })
  }
  return ctx
}

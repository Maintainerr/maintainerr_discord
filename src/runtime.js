import { openDatabase } from './db.js'
export async function createContext(config, logger) {
  const store = openDatabase(config.dbPath)
  return { config, logger, store, cleanup: [() => store.close()] }
}

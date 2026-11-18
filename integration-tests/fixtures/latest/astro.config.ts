import { fileURLToPath } from 'node:url'
import { createAstroConfig } from '../shared/config.js'

const fixtureDirectory = fileURLToPath(new URL('.', import.meta.url))

export default createAstroConfig(fixtureDirectory)

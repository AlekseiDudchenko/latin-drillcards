import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const pub = path.join(__dirname, 'public')

// Express 5 serves nothing from a static mount listed in a path array; mount each base separately.
const files = express.static(pub, { extensions: ['html'] })
app.use('/de-trainer', files)
app.use(files)

// SPA fallback
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(pub, 'index.html'))
})

const PORT = 5173
app.listen(PORT, () => {
  console.log(`Local: http://localhost:${PORT}/`)
})

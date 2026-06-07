/**
 * cPanel / Passenger entry point.
 * Set "Application startup file" to: server.js
 * Requires a production build first: npm run build
 */
const fs = require('fs')
const path = require('path')

const standaloneDir = path.join(__dirname, '.next', 'standalone')
const entry = path.join(standaloneDir, 'server.js')

if (!fs.existsSync(entry)) {
  console.error(
    [
      'Next.js standalone build not found at .next/standalone/server.js',
      'Run on the server:',
      '  npm ci',
      '  npx prisma generate',
      '  npm run build',
    ].join('\n')
  )
  process.exit(1)
}

process.chdir(standaloneDir)
require(entry)

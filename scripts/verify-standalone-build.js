const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '.next', 'standalone')
const required = [
  'server.js',
  'package.json',
  path.join('.next', 'server'),
  path.join('.next', 'static'),
  'public',
]

let failed = false

for (const rel of required) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) {
    console.error(`Missing required deploy file: ${rel}`)
    failed = true
  }
}

if (failed) {
  process.exit(1)
}

console.log('Standalone build verified — ready for FTP upload')

'use strict'
const fs = require('node:fs')
const path = require('node:path')

const SKILLS_SRC = path.resolve(__dirname, '..', '..', 'skills')

/** Names of the skill directories shipped in this package (each holds a SKILL.md). */
function shippedSkills(src = SKILLS_SRC) {
  return fs
    .readdirSync(src, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(src, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort()
}

/** Copy every shipped skill into destDir/<name>/, replacing an older copy. Returns the number placed. */
function placeSkills(destDir, src = SKILLS_SRC) {
  const names = shippedSkills(src)
  fs.mkdirSync(destDir, { recursive: true })
  for (const name of names) {
    const dest = path.join(destDir, name)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(path.join(src, name), dest, { recursive: true })
  }
  return names.length
}

/** Remove only the directories in destDir named after a shipped skill. Returns the number removed. */
function removeSkills(destDir, src = SKILLS_SRC) {
  let removed = 0
  for (const name of shippedSkills(src)) {
    const dest = path.join(destDir, name)
    if (!fs.existsSync(dest)) continue
    fs.rmSync(dest, { recursive: true, force: true })
    removed++
  }
  return removed
}

module.exports = { SKILLS_SRC, shippedSkills, placeSkills, removeSkills }

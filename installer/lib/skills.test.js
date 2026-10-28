'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { SKILLS_SRC, shippedSkills, placeSkills, removeSkills } = require('./skills')

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leadsync-skills-'))

test('shippedSkillsListsTheRepoSkills', () => {
  assert.equal(SKILLS_SRC, path.resolve(__dirname, '..', '..', 'skills'))
  assert.deepEqual(shippedSkills(), ['connecting-lead-forms', 'leadsync-setup', 'troubleshooting-lead-delivery'])
})

test('placeSkillsCopiesEveryShippedSkill', () => {
  const dest = path.join(tempDir(), 'nested', 'skills')
  fs.mkdirSync(path.join(dest, 'leadsync-setup'), { recursive: true })
  fs.writeFileSync(path.join(dest, 'leadsync-setup', 'stale.md'), 'old')
  assert.equal(placeSkills(dest), 3)
  for (const name of shippedSkills()) {
    assert.equal(
      fs.readFileSync(path.join(dest, name, 'SKILL.md'), 'utf8'),
      fs.readFileSync(path.join(SKILLS_SRC, name, 'SKILL.md'), 'utf8'),
    )
  }
  assert.equal(fs.existsSync(path.join(dest, 'leadsync-setup', 'stale.md')), false)
})

test('removeSkillsLeavesForeignDirs', () => {
  const dest = tempDir()
  placeSkills(dest)
  fs.mkdirSync(path.join(dest, 'my-own-skill'))
  fs.writeFileSync(path.join(dest, 'my-own-skill', 'SKILL.md'), 'mine')
  assert.equal(removeSkills(dest), 3)
  assert.deepEqual(fs.readdirSync(dest), ['my-own-skill'])
  assert.equal(removeSkills(path.join(dest, 'missing')), 0)
})

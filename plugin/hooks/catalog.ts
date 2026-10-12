// Bootstrap catalog: replaced by tools/generate-tags/generate.py in Task 5.
import type { CatalogEntry } from '../types'

const entry = (id: string, caption: string, riff: string, isVoice = true): CatalogEntry => ({
  id: `pt:${id}`,
  file: `sounds/${id}.wav`,
  caption,
  riff,
  durationMs: 2000,
  peaks: [],
  isVoice,
})

export const CATALOG: readonly CatalogEntry[] = [
  entry('anthropic-trust', "If Anthropic don't trust you, I'm gon' shoot you", 'Metro Boomin'),
  entry('just-merged', 'Oh Lord, Claude just merged another one', 'Jetsonmade'),
  entry('did-it-again', 'Claude Code, you did it again', 'Mike WiLL Made-It'),
  entry('tests-passin', "We got tests passin' on the track", 'original'),
  entry('opus-come-out', 'Yo Opus, you wanna come out here?', "Pi'erre Bourne"),
  entry('fable-on-beat', "Fable on the beat, so it's a banger", 'Murda Beatz'),
  entry('sonnet-booth', 'Sonnet in the booth, write it down', 'original'),
  entry('haiku-quick', 'Haiku on the beat, make it quick', 'original'),
  entry('who-let-model', 'Who let this model on the track?', 'original'),
  entry('claude-outta', 'Claude outta here', 'Wheezy'),
  entry('khaled-claude', 'Claude Code, Claude Code, Claude Code-ah', 'DJ Khaled'),
  entry('another-one', 'Another one', 'DJ Khaled'),
  entry('tay-keith-fix', 'Tay Keith, fix this', 'Tay Keith'),
  entry('808-boom', '808 boom', 'studio', false),
  entry('riser', 'Riser', 'studio', false),
  entry('scratch', 'Scratch', 'studio', false),
]

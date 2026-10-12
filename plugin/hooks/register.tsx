import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NowPlaying } from '../types'
import type { Host } from './host'
import { resolveSound } from './library'
import { act, logError } from './notify'
import { fireDetached, firePreview, muteAnswer, recoverStage, registerMute, schedule } from './pipeline'
import { ensureLoaded, loadFromStore } from './settings'
import { isOnStage } from './stage'
import { EMPTY_DRAFT, NO_WORD } from './state'
import { bashFacts, hitFor, modelTrigger, pickBashHit, sessionCloseTrigger, sessionOpenTrigger, turnDoneTrigger } from './triggers'
import { badgeView } from './ui/badges'
import { bandView } from './ui/band'
import { modesWith } from './ui/mode'

// The atoms of every `$.state` value (spec §9.2). They are declared here, in the one file that
// reads and writes them: the engine takes an atom only from a const of the calling file.
const settingsAtom = atom({ plugin: 'producer-tags', key: 'settings' } as const, null)
const importsAtom = atom({ plugin: 'producer-tags', key: 'imports' } as const, null)
const nowPlayingAtom = atom({ plugin: 'producer-tags', key: 'nowPlaying' } as const, null)
const bandFrameAtom = atom({ plugin: 'producer-tags', key: 'bandFrame' } as const, 0)
const captionWordAtom = atom({ plugin: 'producer-tags', key: 'captionWord' } as const, NO_WORD)
const taggedAtom = atom({ plugin: 'producer-tags', key: 'tagged' } as const, null)
const platformAtom = atom({ plugin: 'producer-tags', key: 'platform' } as const, null)
const cooldownsAtom = atom({ plugin: 'producer-tags', key: 'cooldowns' } as const, {})
const toastedAtom = atom({ plugin: 'producer-tags', key: 'toasted' } as const, [])
const paneDraftAtom = atom({ plugin: 'producer-tags', key: 'paneDraft' } as const, EMPTY_DRAFT)

/**
 * Binds a Host from a hook's `$`. Declared in this file, each member spelled `$.noun.event(...)`,
 * so the engine reads what the module calls off its source.
 */
function hostOf($: EngineInterface): Host {
  return {
    root: $.plugin.root,
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    every: (ms, fn) => $.clock.every(ms, fn),
    run: (argv, init) => $.process.run(argv, init),
    spawn: request => $.process.spawn(request),
    play: (clip, options) => $.audio.play(clip, options),
    readText: path => $.fs.read(path),
    readBytes: path => $.fs.read(path, { as: 'bytes' }),
    exists: path => $.fs.exists(path),
    stat: path => $.fs.stat(path),
    list: path => $.fs.list(path),
    env: {
      os: () => $.env.get('OS'),
      home: () => $.env.get('HOME'),
      userProfile: () => $.env.get('USERPROFILE'),
      configDir: () => $.env.get('CLAUDE_CONFIG_DIR'),
      wslEnv: () => $.env.get('WSLENV'),
    },
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    toast: text => $.ui.toast(text),
    log: text => $.ui.log(text, { to: 'debug' }),
    openPane: pane => $.ui.open(pane),
    registerCommand: spec => $.command.register(spec),
    state: {
      settings: { read: () => read($, settingsAtom), update: change => update($, settingsAtom, change) },
      imports: { read: () => read($, importsAtom), update: change => update($, importsAtom, change) },
      nowPlaying: { read: () => read($, nowPlayingAtom), update: change => update($, nowPlayingAtom, change) },
      bandFrame: { read: () => read($, bandFrameAtom), update: change => update($, bandFrameAtom, change) },
      captionWord: { read: () => read($, captionWordAtom), update: change => update($, captionWordAtom, change) },
      platform: { read: () => read($, platformAtom), update: change => update($, platformAtom, change) },
      cooldowns: { read: () => read($, cooldownsAtom), update: change => update($, cooldownsAtom, change) },
      toasted: { read: () => read($, toastedAtom), update: change => update($, toastedAtom, change) },
      paneDraft: { read: () => read($, paneDraftAtom), update: change => update($, paneDraftAtom, change) },
    },
    tag: (toolUseId, sound) => update($, memberOf(taggedAtom, { requestId: toolUseId }), () => sound),
  }
}

export const register: Register = on => {
  /**
   * The engine as `session.start` bound it. Buttons and timers act through it; a hook uses it,
   * or binds its own `$` while it is still null (before `session.start`, or after a hot reload
   * until `session.start` runs again and rebinds it).
   */
  let host: Host | null = null
  let muteCommand: 'mute' | 'tags-mute' = 'mute'

  // One session.start hook per plugin: every load-time step of the mod is here.
  on('session.start', async ($, e, next) => {
    const engine = hostOf($)
    host = engine
    try {
      await loadFromStore(engine)
    } catch (error) {
      logError(engine, 'session.start', error)
    }
    try {
      await recoverStage(engine)
    } catch (error) {
      logError(engine, 'session.start', error)
    }
    try {
      muteCommand = await registerMute(engine)
    } catch (error) {
      logError(engine, 'session.start', error)
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (next.origin.plugin === 'engine') {
      const input = { command: e.command, run_in_background: e.run_in_background, isAborted: next.signal.aborted }
      schedule(host ?? hostOf($), settings => pickBashHit(settings, bashFacts(input, ran)), e.tool_use_id)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('classic.PostModelSwitch', ($, e, next) => {
    try {
      schedule(host ?? hostOf($), settings => hitFor(settings, modelTrigger(e)))
    } catch (error) {
      logError(host ?? hostOf($), 'classic.PostModelSwitch', error)
    }
    return next(e)
  })
  on('classic.SessionStart', ($, e, next) => {
    try {
      schedule(host ?? hostOf($), settings => hitFor(settings, sessionOpenTrigger(e.source)))
    } catch (error) {
      logError(host ?? hostOf($), 'classic.SessionStart', error)
    }
    return next(e)
  })
  on('classic.Stop', ($, e, next) => {
    try {
      schedule(host ?? hostOf($), settings => hitFor(settings, turnDoneTrigger(e.stop_hook_active === true)))
    } catch (error) {
      logError(host ?? hostOf($), 'classic.Stop', error)
    }
    return next(e)
  })

  // The outro is launched, not awaited: session.end has one short budget for every hook (spec
  // §6.3). It binds this hook's own `$`, so the launch belongs to the session.end dispatch.
  on('session.end', ($, e, next) => {
    const engine = hostOf($)
    act(engine, 'session.end', async () => {
      const hit = hitFor((await ensureLoaded(engine)).settings, sessionCloseTrigger(e.reason))
      if (hit !== null) await fireDetached(engine, hit)
    })
    return next(e)
  })

  on('command.run', { command: 'mute' }, async ($, e, next) => {
    if (muteCommand !== 'mute') return next(e)
    return muteAnswer(host ?? hostOf($))
  })
  on('command.run', { command: 'tags-mute' }, async $ => muteAnswer(host ?? hostOf($)))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    let show: { np: NowPlaying; now: number; frame: number; word: number } | null = null
    try {
      const np = await read($, nowPlayingAtom)
      const settings = await read($, settingsAtom)
      const frame = await read($, bandFrameAtom)
      const word = await read($, captionWordAtom)
      const now = await $.clock.now()
      if (np !== null && isOnStage(np, now) && settings?.studio.band !== false && !e.props.hasSurvey) show = { np, now, frame, word }
    } catch (error) {
      logError(host ?? hostOf($), 'band', error)
    }
    const engine = await next(e) // called exactly once, whatever the band does
    if (show === null) return engine
    try {
      const { Box, Text } = $.ui.resolve(e)
      return bandView({ Box, Text }, show.np, show.now, show.frame, show.word, engine)
    } catch (error) {
      logError(host ?? hostOf($), 'band', error)
      return engine
    }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const settings = await read($, settingsAtom).catch(() => null)
    if (settings === null) return next(e)
    return next({ ...e, props: { ...e.props, modes: modesWith(e.props.modes, settings) } })
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    try {
      const soundId = await read($, memberOf(taggedAtom, e))
      if (soundId === null) return next(e)
      const settings = await read($, settingsAtom)
      if (settings?.studio.badges === false) return next(e)
      const sound = resolveSound(soundId, (await read($, importsAtom)) ?? [])
      if (sound === null) return next(e)
      const engine = host ?? hostOf($)
      const { Box, Button, Text } = $.ui.resolve(e)
      const replay = () => act(engine, 'replay', () => firePreview(engine, soundId))
      return badgeView({ Box, Button, Text }, await next(e), sound, `pt-${e.requestId}`.slice(0, 64), replay)
    } catch (error) {
      logError(host ?? hostOf($), 'badge', error)
      return next(e)
    }
  })
}

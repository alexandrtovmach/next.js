import type { TurbopackMessageAction } from '../../../../server/dev/hot-reloader-types'
import type { Update as TurbopackUpdate } from '../../../../build/swc/types'
import type { TurbopackMsgToBrowser } from '../../../../server/dev/hot-reloader-types'
import { useCallback, useEffect, useRef } from 'react'
import type { useSendMessage } from './use-websocket'

declare global {
  interface Window {
    __NEXT_HMR_TURBOPACK_REPORT_NOISY_NOOP_EVENTS: boolean | undefined
  }
}

// How long to wait before reporting the HMR start, used to suppress irrelevant
// `BUILDING` events. Does not impact reported latency.
const TURBOPACK_HMR_START_DELAY_MS = 100

export const IS_TURBOPACK = !!process.env.TURBOPACK

interface Built {
  hasUpdates: boolean
  updatedModules: Set<string>
  startMsSinceEpoch: number
  endMsSinceEpoch: number
}

export class TurbopackHmr {
  #updatedModules: Set<string>
  #startMsSinceEpoch: number | undefined
  #lastUpdateMsSinceEpoch: number | undefined
  #deferredReportHmrStartId: ReturnType<typeof setTimeout> | undefined

  constructor() {
    this.#updatedModules = new Set()
  }

  // HACK: Turbopack tends to generate a lot of irrelevant "BUILDING" actions,
  // as it reports *any* compilation, including fully no-op/cached compilations
  // and those unrelated to HMR. Fixing this would require significant
  // architectural changes.
  //
  // Work around this by deferring any "rebuilding" message by 100ms. If we get
  // a BUILT event within that threshold and nothing has changed, just suppress
  // the message entirely.
  #runDeferredReportHmrStart() {
    if (this.#deferredReportHmrStartId != null) {
      console.log('[Fast Refresh] rebuilding')
      this.#cancelDeferredReportHmrStart()
    }
  }

  #cancelDeferredReportHmrStart() {
    clearTimeout(this.#deferredReportHmrStartId)
    this.#deferredReportHmrStartId = undefined
  }

  onBuilding() {
    this.#lastUpdateMsSinceEpoch = undefined
    this.#cancelDeferredReportHmrStart()
    this.#startMsSinceEpoch = Date.now()

    if (self.__NEXT_HMR_TURBOPACK_REPORT_NOISY_NOOP_EVENTS) {
      // debugging feature: don't defer/suppress noisy no-op HMR update messages
      this.#runDeferredReportHmrStart()
    } else {
      // report the HMR start after a short delay
      this.#deferredReportHmrStartId = setTimeout(
        () => this.#runDeferredReportHmrStart(),
        TURBOPACK_HMR_START_DELAY_MS
      )
    }
  }

  onTurbopackMessage(msg: TurbopackMessageAction) {
    this.#lastUpdateMsSinceEpoch = Date.now()
    const updatedModules = extractModulesFromTurbopackMessage(msg.data)
    if (updatedModules.size) {
      this.#runDeferredReportHmrStart()
      for (const module of extractModulesFromTurbopackMessage(msg.data)) {
        this.#updatedModules.add(module)
      }
    }
  }

  onBuilt(): Built | null {
    const hasUpdates = this.#lastUpdateMsSinceEpoch != null
    if (!hasUpdates && this.#deferredReportHmrStartId != null) {
      // suppress the update entirely
      this.#cancelDeferredReportHmrStart()
      return null
    }

    this.#runDeferredReportHmrStart()

    // Turbopack has a debounce which causes every BUILT message to appear
    // 30ms late. We don't want to include this latency in our reporting, so
    // prefer to use the last TURBOPACK_MESSAGE time.
    const endMsSinceEpoch = this.#lastUpdateMsSinceEpoch ?? Date.now()
    const latencyMs = endMsSinceEpoch - this.#startMsSinceEpoch!
    console.log(`[Fast Refresh] done in ${latencyMs}ms`)

    const result = {
      hasUpdates,
      updatedModules: this.#updatedModules,
      startMsSinceEpoch: this.#startMsSinceEpoch!,
      endMsSinceEpoch: this.#lastUpdateMsSinceEpoch ?? Date.now(),
    }
    this.#updatedModules = new Set()
    return result
  }
}

function extractModulesFromTurbopackMessage(
  data: TurbopackUpdate | TurbopackUpdate[]
): Set<string> {
  const updatedModules: Set<string> = new Set()

  const updates = Array.isArray(data) ? data : [data]
  for (const update of updates) {
    // TODO this won't capture changes to CSS since they don't result in a "merged" update
    if (
      update.type !== 'partial' ||
      update.instruction.type !== 'ChunkListUpdate' ||
      update.instruction.merged === undefined
    ) {
      continue
    }

    for (const mergedUpdate of update.instruction.merged) {
      for (const name of Object.keys(mergedUpdate.entries)) {
        const res = /(.*)\s+\[.*/.exec(name)
        if (res === null) {
          console.error(
            '[Turbopack HMR] Expected module to match pattern: ' + name
          )
          continue
        }

        updatedModules.add(res[1])
      }
    }
  }

  return updatedModules
}

export function useTurbopack(
  sendMessage: ReturnType<typeof useSendMessage>,
  onUpdateError: (err: unknown) => void
) {
  const turbopackState = useRef<{
    init: boolean
    queue: Array<TurbopackMsgToBrowser> | undefined
    callback: ((msg: TurbopackMsgToBrowser) => void) | undefined
  }>({
    init: false,
    // Until the dynamic import resolves, queue any turbopack messages which will be replayed.
    queue: [],
    callback: undefined,
  })

  const processTurbopackMessage = useCallback((msg: TurbopackMsgToBrowser) => {
    const { callback, queue } = turbopackState.current
    if (callback) {
      callback(msg)
    } else {
      queue!.push(msg)
    }
  }, [])

  useEffect(() => {
    const { current: initCurrent } = turbopackState
    // TODO(WEB-1589): only install if `process.turbopack` set.
    if (initCurrent.init) {
      return
    }
    initCurrent.init = true

    import(
      // @ts-expect-error requires "moduleResolution": "node16" in tsconfig.json and not .ts extension
      '@vercel/turbopack-ecmascript-runtime/browser/dev/hmr-client/hmr-client.ts'
    ).then(({ connect }) => {
      const { current } = turbopackState
      connect({
        addMessageListener(cb: (msg: TurbopackMsgToBrowser) => void) {
          current.callback = cb

          // Replay all Turbopack messages before we were able to establish the HMR client.
          for (const msg of current.queue!) {
            cb(msg)
          }
          current.queue = undefined
        },
        sendMessage,
        onUpdateError,
      })
    })
  }, [sendMessage, onUpdateError])

  return processTurbopackMessage
}

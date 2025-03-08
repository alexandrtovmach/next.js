import { useCallback, useContext, useEffect, useRef } from 'react'
import { GlobalLayoutRouterContext } from '../../../../shared/lib/app-router-context.shared-runtime'
import { getSocketUrl } from './get-socket-url'
import { IS_TURBOPACK } from './turbopack-hot-reloader-common'

declare global {
  interface Window {
    __NEXT_HMR_LATENCY_CB: ((latencyMs: number) => void) | undefined
  }
}

export function useWebsocket(assetPrefix: string) {
  const webSocketRef = useRef<WebSocket>(undefined)

  useEffect(() => {
    if (webSocketRef.current) {
      return
    }

    const url = getSocketUrl(assetPrefix)

    webSocketRef.current = new window.WebSocket(`${url}/_next/webpack-hmr`)
  }, [assetPrefix])

  return webSocketRef
}

export function useSendMessage(webSocketRef: ReturnType<typeof useWebsocket>) {
  const sendMessage = useCallback(
    (data: string) => {
      const socket = webSocketRef.current
      if (!socket || socket.readyState !== socket.OPEN) {
        return
      }
      return socket.send(data)
    },
    [webSocketRef]
  )
  return sendMessage
}

export function useWebsocketPing(
  websocketRef: ReturnType<typeof useWebsocket>
) {
  const sendMessage = useSendMessage(websocketRef)
  const { tree } = useContext(GlobalLayoutRouterContext)

  useEffect(() => {
    // Never send pings when using Turbopack as it's not used.
    // Pings were originally used to keep track of active routes in on-demand-entries with webpack.
    if (IS_TURBOPACK) {
      return
    }

    // Taken from on-demand-entries-client.js
    const interval = setInterval(() => {
      sendMessage(
        JSON.stringify({
          event: 'ping',
          tree,
          appDirRoute: true,
        })
      )
    }, 2500)
    return () => clearInterval(interval)
  }, [tree, sendMessage])
}

export function reportHmrLatency(
  sendMessage: (message: string) => void,
  updatedModules: ReadonlyArray<string>,
  startMsSinceEpoch: number,
  endMsSinceEpoch: number
) {
  sendMessage(
    JSON.stringify({
      event: 'client-hmr-latency',
      id: window.__nextDevClientId,
      startTime: startMsSinceEpoch,
      endTime: endMsSinceEpoch,
      page: window.location.pathname,
      updatedModules,
      // Whether the page (tab) was hidden at the time the event occurred.
      // This can impact the accuracy of the event's timing.
      isPageHidden: document.visibilityState === 'hidden',
    })
  )
  if ('NEXT_HMR_LATENCY_CB' in self && self.__NEXT_HMR_LATENCY_CB) {
    const latencyMs = endMsSinceEpoch - startMsSinceEpoch
    self.__NEXT_HMR_LATENCY_CB(latencyMs)
  }
}

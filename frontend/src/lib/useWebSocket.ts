import { useEffect, useRef, useCallback } from "react"

const WS_URL = "ws://localhost:8000/ws"

export function useWebSocket(enabled: boolean, onMessage?: (data: unknown) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  useEffect(() => { onMessageRef.current = onMessage }, [onMessage])

  useEffect(() => {
    if (!enabled) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => console.log("[WS] connected")
    ws.onmessage = (e) => {
      try { onMessageRef.current?.(JSON.parse(e.data)) } catch { /* ignore */ }
    }
    ws.onerror = (e) => console.error("[WS] error", e)
    ws.onclose = (e) => {
      console.warn(`[WS] closed (code=${e.code}, reason=${e.reason})`)
      wsRef.current = null
    }

    return () => {
      ws.onopen = null
      ws.onerror = null
      ws.onclose = null
      ws.close()
      wsRef.current = null
    }
  }, [enabled])

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current
    if (!ws) {
      console.error("[WS] send failed: no connection")
      return
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
      console.log("[WS] sent", data)
    } else if (ws.readyState === WebSocket.CONNECTING) {
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify(data))
        console.log("[WS] sent (after connect)", data)
      }, { once: true })
    } else {
      console.error(`[WS] send failed: socket readyState=${ws.readyState}`)
    }
  }, [])

  return { send }
}

import { useEffect, useRef } from 'react'
import io from 'socket.io-client'
import { getWsUrl } from '../config/api'

export const useSocket = ({
  userId,
  currentSessionId,
  onSessionInitialized,
  onMessage,
  onMessageStream,
  onMessageDone,
  onSessionTitleUpdated,
  onSessionsUpdated,
  onError,
  onConnectError,
  onDisconnect,
}) => {
  const socket = useRef(null)
  const hasStreamedRef = useRef(false)

  useEffect(() => {
    if (!userId) return

    socket.current = io(getWsUrl())

    socket.current.on('connect', () => {
      console.log('Socket connected')
    })

    socket.current.on('connect_error', () => {
      console.log('Socket connection error')
      if (onConnectError) onConnectError()
    })

    socket.current.on('disconnect', () => {
      console.log('Socket disconnected')
      hasStreamedRef.current = false
      if (onDisconnect) onDisconnect()
    })

    // Final full message (used as fallback if no streaming happened)
    socket.current.on('message', (content) => {
      if (hasStreamedRef.current) {
        // We already built content from deltas; ignore to prevent duplication
        return
      }
      if (onMessage) onMessage(content)
    })

    // Streaming handlers
    socket.current.on('message_stream', (delta) => {
      hasStreamedRef.current = true
      if (onMessageStream) onMessageStream(delta)
    })

    socket.current.on('message_done', () => {
      if (onMessageDone) onMessageDone()
      // reset for next turn
      setTimeout(() => {
        hasStreamedRef.current = false
      }, 0)
    })

    socket.current.on('session_initialized', (data) => {
      if (onSessionInitialized) onSessionInitialized(data)
    })

    socket.current.on('error', (error) => {
      hasStreamedRef.current = false
      if (onError) onError(error)
    })

    socket.current.on('session_title_updated', (data) => {
      if (onSessionTitleUpdated) onSessionTitleUpdated(data)
    })

    socket.current.on('sessions_updated', () => {
      if (onSessionsUpdated) onSessionsUpdated()
    })

    return () => {
      if (socket.current) {
        socket.current.disconnect()
      }
    }
  }, [userId])

  const initSession = (sessionId) => {
    if (socket.current) {
      socket.current.emit('init_session', { userId, sessionId })
    }
  }

  const sendMessage = (message) => {
    if (socket.current) {
      socket.current.emit('message', message)
    }
  }

  const waitForConnection = (callback) => {
    if (socket.current) {
      if (socket.current.connected) {
        callback()
      } else {
        socket.current.on('connect', callback)
      }
    }
  }

  return {
    socket: socket.current,
    initSession,
    sendMessage,
    waitForConnection,
    hasStreamedRef,
  }
}

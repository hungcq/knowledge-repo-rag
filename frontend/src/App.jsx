import React, { useEffect, useRef, useState } from 'react'
import 'antd/dist/reset.css'
import {
  App,
  Button,
  ConfigProvider,
  Divider,
  Grid,
  Input,
  Layout,
  Space,
  Spin,
  Typography,
  theme,
} from 'antd'
import { SendOutlined } from '@ant-design/icons'
import { ChatHistory } from './components/ChatHistory'
import { Message } from './components/Message'
import { sessionService } from './services/sessionService'
import { useSocket } from './hooks/useSocket'
import {
  getOrCreateUserIdInQuery,
  getSessionIdFromPath,
  updateSessionPath,
} from './utils/urlUtils'

const { Header, Sider, Content, Footer } = Layout
const { Text, Title } = Typography
const { useBreakpoint } = Grid

const Chat = () => {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sessions, setSessions] = useState([])
  const [filteredSessions, setFilteredSessions] = useState([])
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [userId, setUserId] = useState(null)
  const [isSessionInitializing, setIsSessionInitializing] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const messagesEndRef = useRef(null)
  const screens = useBreakpoint()
  const [siderCollapsed, setSiderCollapsed] = useState(false)

  useEffect(() => {
    setSiderCollapsed(!screens.lg)
  }, [screens.lg])

  // Initialize userId from query params
  useEffect(() => {
    const id = getOrCreateUserIdInQuery()
    setUserId(id)

    // Check if there's a sessionId in the URL path
    const pathSessionId = getSessionIdFromPath()
    if (pathSessionId) {
      setCurrentSessionId(pathSessionId)
    }
  }, [])

  // Socket connection and event handlers
  const { initSession, sendMessage: emitMessage, waitForConnection, hasStreamedRef } = useSocket({
    userId,
    currentSessionId,
    onSessionInitialized: (data) => {
      if (!currentSessionId) {
        setCurrentSessionId(data.sessionId)
        updateSessionPath(data.sessionId)
      }
      setIsSessionInitializing(false)
    },
    onMessage: (content) => {
      if (hasStreamedRef.current) {
        return // Ignore to prevent duplication
      }
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1]
        if (lastMessage?.role === 'assistant') {
          return [
            ...prev.slice(0, prev.length - 1),
            { ...lastMessage, content: (lastMessage.content || '') + content },
          ]
        }
        return [...prev, { role: 'assistant', content }]
      })
      setIsGenerating(false)
    },
    onMessageStream: (delta) => {
      setMessages((prev) => {
        if (prev.length === 0 || prev[prev.length - 1].role !== 'assistant') {
          return [...prev, { role: 'assistant', content: delta || '' }]
        }
        const last = prev[prev.length - 1]
        return [...prev.slice(0, -1), { ...last, content: (last.content || '') + (delta || '') }]
      })
    },
    onMessageDone: () => {
      setIsGenerating(false)
    },
    onSessionTitleUpdated: (data) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === data.sessionId ? { ...s, title: data.title } : s))
      )
      setFilteredSessions((prev) =>
        prev.map((s) => (s.id === data.sessionId ? { ...s, title: data.title } : s))
      )
    },
    onSessionsUpdated: () => {
      loadSessions()
    },
    onError: (error) => {
      setIsSessionInitializing(false)
      setIsGenerating(false)
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${error}` }])
    },
    onConnectError: () => {
      setIsSessionInitializing(false)
    },
    onDisconnect: () => {
      setIsSessionInitializing(false)
      setIsGenerating(false)
    },
  })

  // Load sessions on mount
  useEffect(() => {
    if (!userId) return

    loadSessions().then((loadedSessions) => {
      const pathSessionId = getSessionIdFromPath()

      if (pathSessionId) {
        // Load messages for the session from URL path
        loadMessages(pathSessionId)
        initSession(pathSessionId)
        setIsSessionInitializing(false)
      } else if (loadedSessions.length === 0) {
        waitForConnection(() => {
          setIsSessionInitializing(true)
          initSession()
        })
      } else {
        setIsSessionInitializing(false)
      }
    })
  }, [userId])

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Session management
  const loadSessions = async () => {
    const data = await sessionService.loadSessions(userId)
    setSessions(data)
    setFilteredSessions(data)
    return data
  }

  const searchSessions = async (query) => {
    const data = await sessionService.searchSessions(userId, query)
    if (data === null) {
      setFilteredSessions(sessions)
    } else {
      setFilteredSessions(data)
    }
  }

  const updateSessionTitle = async (sessionId, newTitle) => {
    const updated = await sessionService.updateSessionTitle(sessionId, newTitle)
    if (updated) {
      const updatedSessions = sessions.map((s) =>
        s.id === sessionId ? { ...s, title: newTitle } : s
      )
      setSessions(updatedSessions)
      setFilteredSessions(updatedSessions)
    }
  }

  const loadMessages = async (sessionId) => {
    const data = await sessionService.loadMessages(sessionId)
    setMessages(data)
  }

  const onSessionSelect = async (sessionId) => {
    setCurrentSessionId(sessionId)
    setMessages([])
    hasStreamedRef.current = false
    if (!screens.lg) setSiderCollapsed(true)
    updateSessionPath(sessionId)
    loadMessages(sessionId)
    initSession(sessionId)
  }

  const onNewChat = async () => {
    setMessages([])
    setCurrentSessionId(null)
    setIsSessionInitializing(true)
    hasStreamedRef.current = false
    updateSessionPath(null)
    initSession()
  }

  const sendMessage = () => {
    if (input.trim() === '') return

    const messageToSend = input
    setInput('')

    if (!currentSessionId) {
      setIsSessionInitializing(true)
      hasStreamedRef.current = false
      setMessages([
        { role: 'user', content: messageToSend },
        { role: 'assistant', content: '' },
      ])

      // Initialize session and send message
      initSession()
      // The message will be sent after session initialization
      // This is a simplified version - in production you'd queue the message
      setTimeout(() => {
        setIsSessionInitializing(false)
        setIsGenerating(true)
        emitMessage(messageToSend)
      }, 1000)

      return
    }

    // Normal path
    setIsGenerating(true)
    hasStreamedRef.current = false
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: messageToSend },
      { role: 'assistant', content: '' },
    ])
    emitMessage(messageToSend)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const showLoading =
    isGenerating || (messages.length > 0 && messages[messages.length - 1].role === 'user')

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: { fontSize: 16, fontSizeLG: 18, lineHeight: 1.6 },
      }}
    >
      <App>
        <style>{`html, body, #root { height: 100%; }`}</style>
        <Layout style={{ maxHeight: '100vh' }}>
          <Sider
            collapsed={siderCollapsed}
            onCollapse={setSiderCollapsed}
            breakpoint="lg"
            collapsedWidth={0}
            width={320}
            style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
          >
            <div style={{ padding: 16 }}>
              <ChatHistory
                sessions={filteredSessions}
                currentSessionId={currentSessionId}
                onSessionSelect={onSessionSelect}
                onNewChat={onNewChat}
                userId={userId}
                onSearch={searchSessions}
                onUpdateSessionTitle={updateSessionTitle}
              />
            </div>
          </Sider>

          <Layout>
            <Header style={{ display: 'flex', alignItems: 'center' }}>
              <Title level={4} style={{ margin: 0 }}>
                Knowledge Repo RAG Chatbot
              </Title>
            </Header>

            <Content
              style={{ padding: 16, display: 'flex', flexDirection: 'column', minHeight: 0 }}
            >
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  overflowY: 'auto',
                }}
              >
                <div
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {!messages.length && !isSessionInitializing && (
                    <Text type="secondary" style={{ textAlign: 'center', fontSize: 18 }}>
                      {filteredSessions.length === 0
                        ? 'Start a conversation by typing a message below'
                        : 'Select a chat from the sidebar or start a new conversation'}
                    </Text>
                  )}

                  {isSessionInitializing && (
                    <Space align="center">
                      <Spin />
                      <Text type="secondary" style={{ fontSize: 16 }}>
                        Initializing session...
                      </Text>
                    </Space>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {messages.map((msg, idx) => (
                    <Message key={idx} message={msg} />
                  ))}

                  {showLoading && (
                    <Space align="center">
                      <Spin />
                      <Text type="secondary" style={{ fontSize: 16 }}>
                        Generating...
                      </Text>
                    </Space>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              <Divider style={{ margin: '8px 0' }} />
              <Space.Compact style={{ width: '100%' }}>
                <Input.TextArea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  placeholder={
                    isSessionInitializing
                      ? 'Initializing session...'
                      : 'Type your message here...'
                  }
                  disabled={isSessionInitializing}
                  style={{ fontSize: 16 }}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={sendMessage}
                  disabled={isSessionInitializing || !input.trim()}
                >
                  Send
                </Button>
              </Space.Compact>
            </Content>

            <Footer style={{ textAlign: 'center' }}>
              © Hung Chu - Knowledge Repo Chatbot ·{' '}
              <a href="https://github.com/hungcq/knowledge-repo-rag" target="_blank" rel="noreferrer">
                GitHub
              </a>{' '}
              ·{' '}
              <a href="https://knowledge-repo.hungcq.com" target="_blank" rel="noreferrer">
                knowledge-repo.hungcq.com
              </a>
            </Footer>
          </Layout>
        </Layout>
      </App>
    </ConfigProvider>
  )
}

export default Chat

import React, { useEffect, useRef, useState } from 'react'
import io from 'socket.io-client'
import Markdown from 'react-markdown'
import 'antd/dist/reset.css'
import {
  App,
  Button,
  ConfigProvider,
  Divider,
  Grid,
  Input,
  Layout,
  List,
  Space,
  Spin,
  Typography,
  theme,
} from 'antd'
import { EditOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons'

const { Header, Sider, Content, Footer } = Layout
const { Text, Title, Paragraph } = Typography
const { useBreakpoint } = Grid

const host = 'api.knowledge-repo-rag.hungcq.com'

// Generate a short random ID (6-8 chars alphanumeric)
const genShortId = () => Math.random().toString(36).slice(2, 8)

// Get userId from query string or create one, then normalize URL
function getOrCreateUserIdInQuery () {
  const url = new URL(window.location.href)
  let id = url.searchParams.get('userId')
  if (!id) {
    id = genShortId()
    url.searchParams.set('userId', id)
    // Keep the same path but add ?userId=...
    window.history.replaceState(null, '', url.toString())
  }
  return id
}

const ChatHistory = ({
  sessions,
  currentSessionId,
  onSessionSelect,
  onNewChat,
  userId,
  onSearch,
  onUpdateSessionTitle,
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const { token } = theme.useToken()

  const handleSearch = (value) => {
    setSearchQuery(value)
    onSearch(value)
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Button type="primary" icon={<PlusOutlined/>} block onClick={onNewChat}>
        New Chat
      </Button>

      <Input.Search
        placeholder="Search conversations..."
        allowClear
        value={searchQuery}
        onChange={(e) => handleSearch(e.target.value)}
      />

      <Text type="secondary">User: {userId}</Text>

      <Title level={5} style={{ margin: 0 }}>
        Chat History
      </Title>

      <List
        dataSource={sessions}
        locale={{ emptyText: 'No chat history yet' }}
        renderItem={(session) => {
          const selected = currentSessionId === session.id
          return (
            <List.Item onClick={() => onSessionSelect(session.id)}
                       style={{ cursor: 'pointer', padding: 0, border: 'none' }}>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  width: '100%',
                  borderRadius: 8,
                  padding: 12,
                  background: selected ? token.colorFillSecondary : 'transparent',
                  transition: 'background 0.2s ease',
                }}
              >
                <div style={{ width: 4, borderRadius: 4, background: selected ? token.colorPrimary : 'transparent' }}/>
                <div style={{ flex: 1 }}>
                  <List.Item.Meta
                    title={
                      <Paragraph
                        style={{ marginBottom: 0 }}
                        ellipsis={{ rows: 2 }}
                        editable={{
                          icon: <EditOutlined/>,
                          tooltip: 'Edit title',
                          onChange: async (val) => {
                            const trimmed = (val || '').trim()
                            if (trimmed) await onUpdateSessionTitle(session.id, trimmed)
                          },
                        }}
                      >
                        {session.title}
                      </Paragraph>
                    }
                    description={
                      <Space size="small" direction="vertical">
                        <Text type="secondary">{new Date(session.updated_at).toLocaleDateString()}</Text>
                        <Text type="secondary">{session._count?.messages || 0} messages</Text>
                      </Space>
                    }
                  />
                </div>
              </div>
            </List.Item>
          )
        }}
      />
    </Space>
  )
}

const Chat = () => {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sessions, setSessions] = useState([])
  const [filteredSessions, setFilteredSessions] = useState([])
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [userId, setUserId] = useState(null)
  const [isSessionInitializing, setIsSessionInitializing] = useState(false)
  const socket = useRef(null)
  const messagesEndRef = useRef(null)
  const screens = useBreakpoint()
  const [siderCollapsed, setSiderCollapsed] = useState(false)

  useEffect(() => {
    setSiderCollapsed(!screens.lg)
  }, [screens.lg])

  // Use query param for userId; if absent, generate a short one each reload
  useEffect(() => {
    const id = getOrCreateUserIdInQuery()
    setUserId(id)
  }, [])

  useEffect(() => {
    if (!userId) return

    socket.current = io(`wss://${host}`)

    socket.current.on('connect', () => {})
    socket.current.on('connect_error', () => setIsSessionInitializing(false))
    socket.current.on('disconnect', () => setIsSessionInitializing(false))

    socket.current.on('message', (content) => {
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1]
        if (lastMessage?.role === 'assistant') {
          return [...prev.slice(0, prev.length - 1), { ...lastMessage, content: lastMessage.content + content }]
        }
        return [...prev, { role: 'assistant', content }]
      })
    })

    socket.current.on('session_initialized', (data) => {
      if (!currentSessionId) setCurrentSessionId(data.sessionId)
      setIsSessionInitializing(false)
    })

    socket.current.on('error', (error) => {
      setIsSessionInitializing(false)
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${error}` }])
    })

    socket.current.on('session_title_updated', (data) => {
      setSessions((prev) => prev.map((s) => (s.id === data.sessionId ? { ...s, title: data.title } : s)))
      setFilteredSessions((prev) => prev.map((s) => (s.id === data.sessionId ? { ...s, title: data.title } : s)))
    })

    socket.current.on('sessions_updated', () => {
      loadSessions()
    })

    loadSessions().then((s) => {
      if (s.length === 0) {
        if (socket.current) {
          if (socket.current.connected) {
            setIsSessionInitializing(true)
            socket.current.emit('init_session', { userId })
          } else {
            socket.current.on('connect', () => {
              setIsSessionInitializing(true)
              socket.current.emit('init_session', { userId })
            })
          }
        }
      } else {
        setIsSessionInitializing(false)
      }
    })

    return () => {
      if (socket.current) socket.current.disconnect()
    }
  }, [userId])

  const scrollToBottom = () => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }
  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const loadSessions = async () => {
    try {
      const response = await fetch(`https://${host}/api/users/${userId}/sessions`)
      const data = await response.json()
      setSessions(data)
      setFilteredSessions(data)
      return data
    } catch (error) {
      return []
    }
  }

  const searchSessions = async (query) => {
    if (!query || query.trim() === '') {
      setFilteredSessions(sessions)
      return
    }
    try {
      const response = await fetch(`https://${host}/api/users/${userId}/sessions/search?q=${encodeURIComponent(query)}`)
      const data = await response.json()
      setFilteredSessions(data)
    } catch (error) {
      setFilteredSessions([])
    }
  }

  const updateSessionTitle = async (sessionId, newTitle) => {
    try {
      const response = await fetch(`https://${host}/api/sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      })
      if (response.ok) {
        const updated = sessions.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
        setSessions(updated)
        setFilteredSessions(updated)
      }
    } catch (error) {}
  }

  const loadMessages = async (sessionId) => {
    try {
      const response = await fetch(`https://${host}/api/sessions/${sessionId}/messages`)
      const data = await response.json()
      setMessages(data)
    } catch (error) {}
  }

  const onSessionSelect = async (sessionId) => {
    setCurrentSessionId(sessionId) // instant update
    setMessages([])
    if (!screens.lg) setSiderCollapsed(true)
    loadMessages(sessionId)
    if (socket.current) socket.current.emit('init_session', { userId, sessionId })
  }

  const onNewChat = async () => {
    setMessages([])
    setCurrentSessionId(null)
    setIsSessionInitializing(true)
    if (socket.current) socket.current.emit('init_session', { userId })
  }

  const sendMessage = () => {
    if (input.trim() === '' || !socket.current) return

    if (!currentSessionId) {
      setIsSessionInitializing(true)
      socket.current.emit('init_session', { userId })
      const messageToSend = input
      setInput('')
      const handleSessionInitialized = (data) => {
        if (!currentSessionId) setCurrentSessionId(data.sessionId)
        setIsSessionInitializing(false)
        setMessages([{ role: 'user', content: messageToSend }])
        socket.current.emit('message', messageToSend)
        socket.current.off('session_initialized', handleSessionInitialized)
      }
      socket.current.on('session_initialized', handleSessionInitialized)
      return
    }

    setMessages([...messages, { role: 'user', content: input }])
    socket.current.emit('message', input)
    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const showLoading = messages.length > 0 && messages[messages.length - 1].role === 'user'

  return (
    <ConfigProvider
      theme={{ algorithm: theme.darkAlgorithm, token: { fontSize: 16, fontSizeLG: 18, lineHeight: 1.6 } }}>
      <App>
        <style>{`html, body, #root { height: 100%; }`}</style>
        <Layout style={{ maxHeight: '100vh' }}>
          <Sider collapsed={siderCollapsed} onCollapse={setSiderCollapsed} breakpoint="lg" collapsedWidth={0}
                 width={320} style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}>
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
            <Header style={{ display: 'flex', alignItems: 'center'}}>
              <Title level={4} style={{ margin: 0 }}>Knowledge Repo RAG Chatbot</Title>
            </Header>

            <Content style={{ padding: 16, display: 'flex', flexDirection: 'column', minHeight: 0}}>
              <div
                style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {!messages.length && !isSessionInitializing && (
                    <Text type="secondary" style={{ textAlign: 'center', fontSize: 18 }}>
                      {filteredSessions.length === 0 ? 'Start a conversation by typing a message below' : 'Select a chat from the sidebar or start a new conversation'}
                    </Text>
                  )}

                  {isSessionInitializing && (
                    <Space align="center">
                      <Spin/>
                      <Text type="secondary" style={{ fontSize: 16 }}>Initializing session...</Text>
                    </Space>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {messages.map((msg, idx) => (
                    <div key={idx}
                         style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                      <Space.Compact direction="vertical" style={{ width: '100%' }}>
                        <Text type="secondary"
                              style={{ fontSize: 12 }}>{msg.role === 'user' ? 'You' : 'Assistant'}</Text>
                        <div style={{
                          padding: 14,
                          borderRadius: 8,
                          border: '1px solid rgba(255,255,255,0.15)',
                          fontSize: 16,
                          lineHeight: 1.6
                        }}>
                          {msg.role === 'user' ? (
                            <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                          ) : (
                            <div style={{ fontSize: 16 }}><Markdown>{msg.content}</Markdown></div>
                          )}
                        </div>
                      </Space.Compact>
                    </div>
                  ))}

                  {showLoading && (
                    <Space align="center">
                      <Spin/>
                      <Text type="secondary" style={{ fontSize: 16 }}>Generating...</Text>
                    </Space>
                  )}
                  <div ref={messagesEndRef}/>
                </div>
              </div>

              <Divider style={{ margin: '8px 0' }}/>
              <Space.Compact style={{ width: '100%' }}>
                <Input.TextArea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  placeholder={isSessionInitializing ? 'Initializing session...' : 'Type your message here...'}
                  disabled={isSessionInitializing} style={{ fontSize: 16 }}/>
                <Button type="primary" icon={<SendOutlined/>} onClick={sendMessage}
                        disabled={isSessionInitializing || !input.trim()}>
                  Send
                </Button>
              </Space.Compact>
            </Content>

            <Footer style={{ textAlign: 'center' }}>
              © Hung Chu - Knowledge Repo Chatbot ·{' '}
              <a href="https://knowledge-repo.hungcq.com" target="_blank" rel="noreferrer">knowledge-repo.hungcq.com</a>
            </Footer>
          </Layout>
        </Layout>
      </App>
    </ConfigProvider>
  )
}

export default Chat

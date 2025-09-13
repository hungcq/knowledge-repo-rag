import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import Markdown from 'react-markdown';
import 'antd/dist/reset.css';
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
} from 'antd';
import {
  EditOutlined,
  PlusOutlined,
  SendOutlined,
} from '@ant-design/icons';

const { Header, Sider, Content, Footer } = Layout;
const { Text, Title, Paragraph } = Typography;
const { useBreakpoint } = Grid;

const host = 'api.knowledge-repo-rag.hungcq.com'

const ChatHistory = ({
  sessions,
  currentSessionId,
  onSessionSelect,
  onNewChat,
  userId,
  onSearch,
  onUpdateSessionTitle,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (value) => {
    setSearchQuery(value);
    onSearch(value);
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Button type="primary" icon={<PlusOutlined />} block onClick={onNewChat}>
        New Chat
      </Button>

      <Input.Search
        placeholder="Search conversations..."
        allowClear
        value={searchQuery}
        onChange={(e) => handleSearch(e.target.value)}
      />

      <Text type="secondary">User: {userId}</Text>

      <Title level={5} style={{ margin: 0 }}>Chat History</Title>

      <List
        dataSource={sessions}
        locale={{ emptyText: 'No chat history yet' }}
        renderItem={(session) => (
          <List.Item
            onClick={() => onSessionSelect(session.id)}
            style={{
              cursor: 'pointer',
              borderRadius: 8,
              border: currentSessionId === session.id ? '1px solid rgba(255,255,255,0.25)' : '1px solid transparent',
            }}
          >
            <List.Item.Meta
              title={
                <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Paragraph
                    style={{ marginBottom: 0, maxWidth: '80%' }}
                    ellipsis={{ rows: 2 }}
                    editable={{
                      icon: <EditOutlined />,
                      tooltip: 'Edit title',
                      onChange: async (val) => {
                        const trimmed = (val || '').trim();
                        if (trimmed) await onUpdateSessionTitle(session.id, trimmed);
                      },
                    }}
                  >
                    {session.title}
                  </Paragraph>
                </Space>
              }
              description={
                <Space size="small" direction="vertical">
                  <Text type="secondary">{new Date(session.updated_at).toLocaleDateString()}</Text>
                  <Text type="secondary">{session._count?.messages || 0} messages</Text>
                </Space>
              }
            />
          </List.Item>
        )}
      />
    </Space>
  );
};

const Chat = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isSessionInitializing, setIsSessionInitializing] = useState(false);
  const socket = useRef(null);
  const messagesEndRef = useRef(null);
  const screens = useBreakpoint();
  const [siderCollapsed, setSiderCollapsed] = useState(false);

  // Collapse sider on small screens
  useEffect(() => {
    if (!screens.lg) {
      setSiderCollapsed(true);
    } else {
      setSiderCollapsed(false);
    }
  }, [screens.lg]);

  // Get userId from URL path
  useEffect(() => {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const userIdFromPath = pathParts[0] || 'default-user';
    setUserId(userIdFromPath);
  }, []);

  useEffect(() => {
    if (!userId) return;

    // Initialize socket connection
    socket.current = io(`wss://${host}`);

    socket.current.on('connect', () => {
      // console.log('Socket connected:', socket.current.id);
    });

    socket.current.on('connect_error', () => {
      setIsSessionInitializing(false);
    });

    socket.current.on('disconnect', () => {
      setIsSessionInitializing(false);
    });

    socket.current.on('message', (content) => {
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage?.role === 'assistant') {
          return [
            ...prev.slice(0, prev.length - 1),
            { ...lastMessage, content: lastMessage.content + content },
          ];
        }
        return [...prev, { role: 'assistant', content }];
      });
    });

    socket.current.on('session_initialized', (data) => {
      setCurrentSessionId(data.sessionId);
      setIsSessionInitializing(false);
    });

    socket.current.on('error', (error) => {
      setIsSessionInitializing(false);
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${error}` }]);
    });

    socket.current.on('session_title_updated', (data) => {
      setSessions((prev) => prev.map((s) => (s.id === data.sessionId ? { ...s, title: data.title } : s)));
      setFilteredSessions((prev) => prev.map((s) => (s.id === data.sessionId ? { ...s, title: data.title } : s)));
    });

    socket.current.on('sessions_updated', () => {
      loadSessions();
    });

    // Load sessions for the user first
    loadSessions().then((s) => {
      if (s.length === 0) {
        if (socket.current) {
          if (socket.current.connected) {
            setIsSessionInitializing(true);
            socket.current.emit('init_session', { userId });
          } else {
            socket.current.on('connect', () => {
              setIsSessionInitializing(true);
              socket.current.emit('init_session', { userId });
            });
          }
        }
      } else {
        setIsSessionInitializing(false);
      }
    });

    return () => {
      if (socket.current) {
        socket.current.disconnect();
      }
    };
  }, [userId]);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadSessions = async () => {
    try {
      const response = await fetch(`https://${host}/api/users/${userId}/sessions`);
      const data = await response.json();
      setSessions(data);
      setFilteredSessions(data);
      return data;
    } catch (error) {
      return [];
    }
  };

  const searchSessions = async (query) => {
    if (!query || query.trim() === '') {
      setFilteredSessions(sessions);
      return;
    }
    try {
      const response = await fetch(`https://${host}/api/users/${userId}/sessions/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      setFilteredSessions(data);
    } catch (error) {
      setFilteredSessions([]);
    }
  };

  const updateSessionTitle = async (sessionId, newTitle) => {
    try {
      const response = await fetch(`https://${host}/api/sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (response.ok) {
        const updated = sessions.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s));
        setSessions(updated);
        setFilteredSessions(updated);
      }
    } catch (error) {
      // no-op
    }
  };

  const loadMessages = async (sessionId) => {
    try {
      const response = await fetch(`https://${host}/api/sessions/${sessionId}/messages`);
      const data = await response.json();
      setMessages(data);
    } catch (error) {
      // no-op
    }
  };

  const onSessionSelect = async (sessionId) => {
    setCurrentSessionId(sessionId);
    await loadMessages(sessionId);
    if (socket.current) {
      socket.current.emit('init_session', { userId, sessionId });
    }
  };

  const onNewChat = async () => {
    setMessages([]);
    setCurrentSessionId(null);
    setIsSessionInitializing(true);
    if (socket.current) {
      socket.current.emit('init_session', { userId });
    }
  };

  const sendMessage = () => {
    if (input.trim() === '' || !socket.current) return;

    if (!currentSessionId) {
      setIsSessionInitializing(true);
      socket.current.emit('init_session', { userId });
      const messageToSend = input;
      setInput('');
      const handleSessionInitialized = (data) => {
        setCurrentSessionId(data.sessionId);
        setIsSessionInitializing(false);
        setMessages([{ role: 'user', content: messageToSend }]);
        socket.current.emit('message', messageToSend);
        socket.current.off('session_initialized', handleSessionInitialized);
      };
      socket.current.on('session_initialized', handleSessionInitialized);
      return;
    }

    setMessages([...messages, { role: 'user', content: input }]);
    socket.current.emit('message', input);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const showLoading = messages.length > 0 && messages[messages.length - 1].role === 'user';

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <App>
        <Layout style={{ minHeight: '100vh' }}>
          <Sider
            collapsible
            collapsed={siderCollapsed}
            onCollapse={setSiderCollapsed}
            breakpoint="lg"
            collapsedWidth={0}
            width={320}
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
              <Title level={4} style={{ margin: 0 }}>Knowledge Repo RAG Chatbot</Title>
            </Header>

            <Content style={{ padding: 16 }}>
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                {!messages.length && !isSessionInitializing && (
                  <Text type="secondary">
                    {filteredSessions.length === 0
                      ? 'Start a conversation by typing a message below'
                      : 'Select a chat from the sidebar or start a new conversation'}
                  </Text>
                )}

                {isSessionInitializing && (
                  <Space align="center">
                    <Spin />
                    <Text type="secondary">Initializing session...</Text>
                  </Space>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      style={{
                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '80%'
                      }}
                    >
                      <Space.Compact direction="vertical" style={{ width: '100%' }}>
                        <Text type="secondary">{msg.role === 'user' ? 'You' : 'Assistant'}</Text>
                        <div style={{
                          padding: 12,
                          borderRadius: 8,
                          border: '1px solid rgba(255,255,255,0.15)'
                        }}>
                          {msg.role === 'user' ? (
                            <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                          ) : (
                            <Markdown>{msg.content}</Markdown>
                          )}
                        </div>
                      </Space.Compact>
                    </div>
                  ))}

                  {showLoading && (
                    <Space align="center">
                      <Spin />
                      <Text type="secondary">Generating...</Text>
                    </Space>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <Divider style={{ margin: '8px 0' }} />

                <Space.Compact style={{ width: '100%' }}>
                  <Input.TextArea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoSize={{ minRows: 1, maxRows: 6 }}
                    placeholder={isSessionInitializing ? 'Initializing session...' : 'Type your message here...'}
                    disabled={isSessionInitializing}
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
              </Space>
            </Content>

            <Footer style={{ textAlign: 'center' }}>
              © Hung Chu - Knowledge Repo Chatbot ·{' '}
              <a href="https://knowledge-repo.hungcq.com" target="_blank" rel="noreferrer">
                knowledge-repo.hungcq.com
              </a>
            </Footer>
          </Layout>
        </Layout>
      </App>
    </ConfigProvider>
  );
};

export default Chat;

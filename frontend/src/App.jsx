import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import Markdown from 'react-markdown';

const LoadingIndicator = () => (
  <div style={{ display: 'flex', gap: '4px', padding: '4px' }}>
    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#9ca3af', animation: 'bounce 1s infinite' }}></div>
    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#9ca3af', animation: 'bounce 1s infinite 0.2s' }}></div>
    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#9ca3af', animation: 'bounce 1s infinite 0.4s' }}></div>
  </div>
);

const ChatHistory = ({ sessions, currentSessionId, onSessionSelect, onNewChat, userId, onSearch, onUpdateSessionTitle }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');

  const handleSearch = (query) => {
    setSearchQuery(query);
    onSearch(query);
  };

  const handleEditTitle = (session) => {
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const handleSaveTitle = async (sessionId) => {
    if (editingTitle.trim()) {
      await onUpdateSessionTitle(sessionId, editingTitle.trim());
    }
    setEditingSessionId(null);
    setEditingTitle('');
  };

  const handleCancelEdit = () => {
    setEditingSessionId(null);
    setEditingTitle('');
  };

  return (
    <div style={{
      width: '300px',
      height: '100vh',
      borderRight: '1px solid #e5e7eb',
      padding: '16px',
      backgroundColor: '#f9fafb',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={onNewChat}
          style={{
            width: '100%',
            padding: '12px 16px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            transition: 'background-color 0.2s ease'
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#2563eb'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#3b82f6'}
        >
          + New Chat
        </button>
      </div>

      {/* Search Input */}
      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '14px',
            outline: 'none',
            transition: 'border-color 0.2s ease'
          }}
          onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
          onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
        />
      </div>
      
      <div style={{ 
        marginBottom: '16px', 
        fontSize: '12px', 
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontWeight: '600'
      }}>
        User: {userId}
      </div>
      
      <div style={{ 
        fontSize: '14px', 
        fontWeight: '600', 
        marginBottom: '16px',
        color: '#374151'
      }}>
        Chat History
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sessions.length === 0 ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: '#6b7280',
            fontSize: '14px'
          }}>
            No chat history yet
          </div>
        ) : (
          sessions.map((session) => (
          <div
            key={session.id}
            style={{
              padding: '12px',
              marginBottom: '8px',
              borderRadius: '8px',
              backgroundColor: currentSessionId === session.id ? '#dbeafe' : 'transparent',
              border: currentSessionId === session.id ? '1px solid #3b82f6' : '1px solid transparent',
              transition: 'all 0.2s ease',
              position: 'relative'
            }}
            onMouseEnter={(e) => {
              if (currentSessionId !== session.id) {
                e.currentTarget.style.backgroundColor = '#f3f4f6';
              }
            }}
            onMouseLeave={(e) => {
              if (currentSessionId !== session.id) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            {editingSessionId === session.id ? (
              <div>
                <input
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveTitle(session.id);
                    } else if (e.key === 'Escape') {
                      handleCancelEdit();
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '4px 8px',
                    border: '1px solid #3b82f6',
                    borderRadius: '4px',
                    fontSize: '14px',
                    fontWeight: '500',
                    outline: 'none',
                    marginBottom: '4px'
                  }}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => handleSaveTitle(session.id)}
                    style={{
                      padding: '2px 8px',
                      fontSize: '12px',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    style={{
                      padding: '2px 8px',
                      fontSize: '12px',
                      backgroundColor: '#6b7280',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => onSessionSelect(session.id)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ 
                  fontSize: '14px', 
                  fontWeight: '500',
                  marginBottom: '4px',
                  color: '#111827',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '8px'
                }}>
                  <span style={{
                    flex: 1,
                    wordWrap: 'break-word',
                    lineHeight: '1.3',
                    maxHeight: '2.6em',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical'
                  }}>{session.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditTitle(session);
                    }}
                    style={{
                      padding: '2px 6px',
                      fontSize: '10px',
                      backgroundColor: 'transparent',
                      color: '#6b7280',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      opacity: 0.7
                    }}
                    onMouseEnter={(e) => e.target.style.opacity = '1'}
                    onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                  >
                    Edit
                  </button>
                </div>
                <div style={{ 
                  fontSize: '12px', 
                  color: '#6b7280',
                  marginBottom: '2px'
                }}>
                  {new Date(session.updated_at).toLocaleDateString()}
                </div>
                <div style={{ 
                  fontSize: '12px', 
                  color: '#9ca3af'
                }}>
                  {session._count?.messages || 0} messages
                </div>
              </div>
            )}
          </div>
          ))
        )}
      </div>
    </div>
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

  // Get userId from URL path
  useEffect(() => {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const userIdFromPath = pathParts[0] || 'default-user';
    setUserId(userIdFromPath);
  }, []);

  useEffect(() => {
    if (!userId) return;

    // Initialize socket connection
    socket.current = io('ws://localhost:1918');

    socket.current.on('connect', () => {
      console.log('Socket connected:', socket.current.id);
    });

    socket.current.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setIsSessionInitializing(false);
    });

    socket.current.on('disconnect', (reason) => {
      console.warn('Socket disconnected:', reason);
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
      console.error('Socket error:', error);
      setIsSessionInitializing(false);
      // Show error message to user
      setMessages((prev) => [...prev, { 
        role: 'assistant', 
        content: `Error: ${error}` 
      }]);
    });

    socket.current.on('session_title_updated', (data) => {
      // Update the session title in the sessions list
      setSessions((prevSessions) => 
        prevSessions.map(session => 
          session.id === data.sessionId 
            ? { ...session, title: data.title }
            : session
        )
      );
      setFilteredSessions((prevSessions) => 
        prevSessions.map(session => 
          session.id === data.sessionId 
            ? { ...session, title: data.title }
            : session
        )
      );
    });

    socket.current.on('test_response', (data) => {
      console.log('Received test response:', data);
    });

    socket.current.on('sessions_updated', (data) => {
      console.log('Sessions updated:', data);
      // Reload sessions to get the latest data
      loadSessions();
    });

    // Load sessions for the user first
    loadSessions().then((sessions) => {
      // If there are existing sessions, don't auto-create a new one
      // User can click "New Chat" to create a new session
      if (sessions.length === 0) {
        // Only auto-create a session if there are no existing sessions
        if (socket.current) {
          console.log('Auto-creating a new session for user:', userId);
          console.log('Socket connected:', socket.current.connected);
          
          // Wait for socket to be connected before emitting
          if (socket.current.connected) {
            setIsSessionInitializing(true);
            socket.current.emit('init_session', { userId });
          } else {
            // Wait for connection before emitting
            console.log('Waiting for socket connection...');
            socket.current.on('connect', () => {
              setIsSessionInitializing(true);
              socket.current.emit('init_session', { userId });
            });
          }
        }
      } else {
        // If there are existing sessions, just set the session state to ready
        setIsSessionInitializing(false);
      }
    });

    return () => {
      if (socket.current) {
        socket.current.disconnect();
      }
    };
  }, [userId]);

  const loadSessions = async () => {
    try {
      const response = await fetch(`http://localhost:1918/api/users/${userId}/sessions`);
      const data = await response.json();
      setSessions(data);
      setFilteredSessions(data);
      return data;
    } catch (error) {
      console.error('Error loading sessions:', error);
      return [];
    }
  };

  const searchSessions = async (query) => {
    if (!query || query.trim() === '') {
      setFilteredSessions(sessions);
      return;
    }

    try {
      const response = await fetch(`http://localhost:1918/api/users/${userId}/sessions/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      setFilteredSessions(data);
    } catch (error) {
      console.error('Error searching sessions:', error);
      setFilteredSessions([]);
    }
  };

  const updateSessionTitle = async (sessionId, newTitle) => {
    try {
      const response = await fetch(`http://localhost:1918/api/sessions/${sessionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: newTitle }),
      });
      
      if (response.ok) {
        // Update the sessions list
        const updatedSessions = sessions.map(session => 
          session.id === sessionId ? { ...session, title: newTitle } : session
        );
        setSessions(updatedSessions);
        setFilteredSessions(updatedSessions);
      }
    } catch (error) {
      console.error('Error updating session title:', error);
    }
  };

  const loadMessages = async (sessionId) => {
    try {
      const response = await fetch(`http://localhost:1918/api/sessions/${sessionId}/messages`);
      const data = await response.json();
      setMessages(data);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const onSessionSelect = async (sessionId) => {
    setCurrentSessionId(sessionId);
    await loadMessages(sessionId);
    
    // Initialize socket session
    if (socket.current) {
      socket.current.emit('init_session', { userId, sessionId });
    }
  };

  const onNewChat = async () => {
    setMessages([]);
    setCurrentSessionId(null);
    setIsSessionInitializing(true);
    
    // Initialize new socket session
    if (socket.current) {
      socket.current.emit('init_session', { userId });
    }
  };

  const sendMessage = () => {
    if (input.trim() === '' || !socket.current) return;
    
    // If no current session, create a new one first
    if (!currentSessionId) {
      setIsSessionInitializing(true);
      socket.current.emit('init_session', { userId });
      // Store the message to send after session is initialized
      const messageToSend = input;
      setInput('');
      
      // Wait for session to be initialized, then send the message
      const handleSessionInitialized = (data) => {
        setCurrentSessionId(data.sessionId);
        setIsSessionInitializing(false);
        // Send the stored message
        setMessages([{ role: 'user', content: messageToSend }]);
        socket.current.emit('message', messageToSend);
        // Remove this one-time listener
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
    if (e.key === 'Enter') {
      if (!e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    }
  };

  const showLoading = messages.length > 0 && messages[messages.length - 1].role === 'user';

  // Test function for debugging socket connection
  const testSocket = () => {
    if (socket.current) {
      console.log('Testing socket connection...');
      console.log('Socket connected:', socket.current.connected);
      socket.current.emit('test', { message: 'Hello from frontend', timestamp: new Date().toISOString() });
    } else {
      console.log('Socket not available');
    }
  };

  // Make test function available globally for debugging
  window.testSocket = testSocket;

  return (
    <div style={{ 
      display: 'flex', 
      height: '100vh',
      backgroundColor: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <ChatHistory
        sessions={filteredSessions}
        currentSessionId={currentSessionId}
        onSessionSelect={onSessionSelect}
        onNewChat={onNewChat}
        userId={userId}
        onSearch={searchSessions}
        onUpdateSessionTitle={updateSessionTitle}
      />
      
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          backgroundColor: '#ffffff'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#ffffff'
        }}>
          <h1 style={{
            margin: 0,
            fontSize: '24px',
            fontWeight: '600',
            color: '#111827'
          }}>
            Knowledge Repo RAG Chatbot
          </h1>
        </div>

        {/* Messages Area */}
        <div
          style={{
            flex: 1,
            padding: '24px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#ffffff'
          }}
        >
          {messages.length === 0 && !isSessionInitializing && (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6b7280',
              fontSize: '16px'
            }}>
              {filteredSessions.length === 0 
                ? "Start a conversation by typing a message below"
                : "Select a chat from the sidebar or start a new conversation"
              }
            </div>
          )}
          
          {isSessionInitializing && (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6b7280',
              fontSize: '16px'
            }}>
              Initializing session...
            </div>
          )}
          
          {messages.map((msg, index) => (
            <div
              key={index}
              style={{
                textAlign: msg.role === 'user' ? 'right' : 'left',
                marginBottom: '16px',
                maxWidth: '80%',
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start'
              }}
            >
              <div
                style={{
                  display: 'inline-block',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  backgroundColor: msg.role === 'user' ? '#3b82f6' : '#f3f4f6',
                  color: msg.role === 'user' ? '#ffffff' : '#111827',
                  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                }}
              >
                {msg.role === 'user' ?
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{msg.content}</div> :
                  <div style={{ lineHeight: '1.5' }}>
                    <Markdown>{msg.content}</Markdown>
                  </div>
                }
              </div>
            </div>
          ))}
          
          {showLoading && (
            <div style={{ textAlign: 'left', marginBottom: '16px' }}>
              <div style={{
                display: 'inline-block',
                padding: '12px 16px',
                borderRadius: '12px',
                backgroundColor: '#f3f4f6',
                boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
              }}>
                <LoadingIndicator />
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div style={{
          padding: '20px 24px',
          borderTop: '1px solid #e5e7eb',
          backgroundColor: '#ffffff'
        }}>
          <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isSessionInitializing}
          style={{ 
            width: '100%', 
            padding: '12px 16px', 
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '14px',
            fontFamily: 'inherit',
            resize: 'none',
            outline: 'none',
            transition: 'border-color 0.2s ease',
            minHeight: '44px',
            maxHeight: '120px',
            backgroundColor: isSessionInitializing ? '#f9fafb' : '#ffffff',
            color: isSessionInitializing ? '#9ca3af' : '#111827'
          }}
          onKeyDown={handleKeyDown}
          placeholder={isSessionInitializing ? "Initializing session..." : "Type your message here..."}
          onFocus={(e) => !isSessionInitializing && (e.target.style.borderColor = '#3b82f6')}
          onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
        />
        </div>
        
        <style>
          {`
            @keyframes bounce {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-4px); }
            }
            
            /* Custom scrollbar */
            ::-webkit-scrollbar {
              width: 6px;
            }
            
            ::-webkit-scrollbar-track {
              background: #f1f5f9;
            }
            
            ::-webkit-scrollbar-thumb {
              background: #cbd5e1;
              border-radius: 3px;
            }
            
            ::-webkit-scrollbar-thumb:hover {
              background: #94a3b8;
            }
          `}
        </style>
      </div>
    </div>
  );
};

export default Chat;
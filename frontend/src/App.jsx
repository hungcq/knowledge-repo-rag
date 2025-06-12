import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import Markdown from 'react-markdown';

const LoadingIndicator = () => (
  <div style={{ display: 'flex', gap: '4px', padding: '10px' }}>
    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#666', animation: 'bounce 1s infinite' }}></div>
    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#666', animation: 'bounce 1s infinite 0.2s' }}></div>
    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#666', animation: 'bounce 1s infinite 0.4s' }}></div>
  </div>
);

const Chat = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const socket = useRef(null);

  useEffect(() => {
    socket.current = io('wss://api.knowledge-repo-rag.hungcq.com');

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

    return () => {
      socket.current.disconnect();
    };
  }, []);

  const sendMessage = () => {
    if (input.trim() === '') return;

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

  return (
      <div
          style={{
            fontFamily: 'Arial, sans-serif',
            padding: '20px',
            maxWidth: '70%',
            margin: 'auto',
            display: 'flex',
            flexDirection: 'column',
            height: '90vh',
          }}
      >
        <h1>Knowledge Repo RAG Chatbot</h1>
        <div
            style={{
              border: '1px solid #ccc',
              padding: '10px',
              minHeight: '300px',
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
            }}
        >
          {messages.map((msg, index) => (
              <div
                  key={index}
                  style={{
                    textAlign: msg.role === 'user' ? 'right' : 'left',
                    marginBottom: '10px',
                  }}
              >
                <div
                    style={{
                      display: 'inline-block',
                      padding: '0px 12px',
                      borderRadius: '10px',
                      background: msg.role === 'user' ? '#3c3c3c' : '#545454',
                    }}
                >
                  {msg.role === 'user' ?
                      <div style={{padding: '10px', whiteSpace: 'pre-wrap'}}>{msg.content}</div> :
                      <Markdown>{msg.content}</Markdown>
                  }
                </div>
              </div>
          ))}
          {showLoading && (
            <div style={{ textAlign: 'left', marginBottom: '10px' }}>
              <div style={{
                display: 'inline-block',
                padding: '0px 12px',
                borderRadius: '10px',
                background: '#545454',
              }}>
                <LoadingIndicator />
              </div>
            </div>
          )}
        </div>
        <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{width: '98%', padding: '10px', marginTop: '10px'}}
            onKeyDown={handleKeyDown}
        />
        <style>
          {`
            @keyframes bounce {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-4px); }
            }
          `}
        </style>
      </div>
  );
};

export default Chat;

import React, { useState } from 'react'
import { Button, Input, List, Space, Typography, theme } from 'antd'
import { EditOutlined, PlusOutlined } from '@ant-design/icons'

const { Text, Title, Paragraph } = Typography

export const ChatHistory = ({
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

      <Title level={5} style={{ margin: 0 }}>
        Chat History
      </Title>

      <List
        dataSource={sessions}
        locale={{ emptyText: 'No chat history yet' }}
        renderItem={(session) => {
          const selected = currentSessionId === session.id
          return (
            <List.Item
              onClick={() => onSessionSelect(session.id)}
              style={{ cursor: 'pointer', padding: 0, border: 'none' }}
            >
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
                <div
                  style={{
                    width: 4,
                    borderRadius: 4,
                    background: selected ? token.colorPrimary : 'transparent',
                  }}
                />
                <div style={{ flex: 1 }}>
                  <List.Item.Meta
                    title={
                      <Paragraph
                        style={{ marginBottom: 0 }}
                        ellipsis={{ rows: 2 }}
                        editable={{
                          icon: <EditOutlined />,
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
                        <Text type="secondary">
                          {new Date(session.updated_at).toLocaleDateString()}
                        </Text>
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

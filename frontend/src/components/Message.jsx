import React from 'react'
import { Space, Typography } from 'antd'
import Markdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'

const { Text } = Typography

export const Message = ({ message }) => {
  const { role, content } = message

  if (!content || content.length === 0) {
    return null
  }

  return (
    <div style={{ alignSelf: role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
      <Space.Compact direction="vertical" style={{ width: '100%' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {role === 'user' ? 'You' : 'Assistant'}
        </Text>
        <div
          style={{
            padding: 14,
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.15)',
            fontSize: 16,
            lineHeight: 1.6,
          }}
        >
          {role === 'user' ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
          ) : (
            <div style={{ fontSize: 16 }}>
              <Markdown rehypePlugins={[rehypeRaw]}>{content}</Markdown>
            </div>
          )}
        </div>
      </Space.Compact>
    </div>
  )
}

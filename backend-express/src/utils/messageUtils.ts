import { AIMessage, AIMessageChunk } from '@langchain/core/messages';

export function messageContentToString(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }

  if (typeof content === 'object' && content !== null) {
    if ('text' in (content as any) && typeof (content as any).text === 'string') {
      return (content as any).text;
    }

    if ('toString' in content) {
      return String(content);
    }
  }

  return '';
}

export function extractChunkText(chunk: unknown): string {
  if (!chunk) {
    return '';
  }

  if (typeof chunk === 'string') {
    return chunk;
  }

  if (chunk instanceof AIMessage || chunk instanceof AIMessageChunk) {
    return messageContentToString(chunk.content);
  }

  if (Array.isArray(chunk)) {
    return chunk.map((part) => extractChunkText(part)).join('');
  }

  if (typeof chunk === 'object') {
    if ('content' in (chunk as any)) {
      return messageContentToString((chunk as any).content);
    }
    if ('text' in (chunk as any)) {
      return String((chunk as any).text ?? '');
    }
  }

  return '';
}
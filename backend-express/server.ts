import express from 'express';
import { Server } from 'socket.io';
import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import { Server as HttpServer } from 'http';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { concat } from '@langchain/core/utils/stream';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config();

// Configure JSON serialization to handle BigInt
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const chatModel = new ChatOpenAI({
  model: process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-nano',
  temperature: 0.2,
});
const embeddingsModel = new OpenAIEmbeddings({
  model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
});
const prisma = new PrismaClient();
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
  apiKey: process.env.QDRANT_API_KEY,
});

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

const RECENT_MESSAGE_LIMIT = toPositiveInt(process.env.CHAT_RECENT_MESSAGE_LIMIT, 10);
const SUMMARY_THRESHOLD_MESSAGES = toPositiveInt(process.env.CHAT_SUMMARY_THRESHOLD, 18);
const SUMMARY_REFRESH_INTERVAL = toPositiveInt(process.env.CHAT_SUMMARY_REFRESH_INTERVAL, 4);
const SUMMARY_CONTEXT_MESSAGE_LIMIT = toPositiveInt(process.env.CHAT_SUMMARY_CONTEXT_LIMIT, 40);

function messageContentToString(content: unknown): string {
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

function extractChunkText(chunk: unknown): string {
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

const app = express();
const server = new HttpServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow frontend to connect
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Middleware
app.use(
  cors({
    origin: '*', // Allow all origins for development
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API Routes
// Get all sessions for a user
app.get('/api/users/:userId/sessions', async (req, res) => {
  try {
    const { userId } = req.params;
    const sessions = await prisma.session.findMany({
      where: {
        user_id: userId,
        archived_at: null,
      },
      orderBy: { updated_at: 'desc' },
      include: {
        session_summaries: true,
        _count: {
          select: { messages: true },
        },
      },
    });
    res.json(sessions);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get messages for a specific session
app.get('/api/sessions/:sessionId/messages', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const messages = await prisma.message.findMany({
      where: { session_id: sessionId },
      orderBy: { idx: 'asc' },
    });
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Create a new session
app.post('/api/users/:userId/sessions', async (req, res) => {
  try {
    const { userId } = req.params;
    const { title } = req.body;

    const session = await prisma.session.create({
      data: {
        user_id: userId,
        title: title || 'New Chat',
      },
    });

    res.json(session);
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Update session title
app.put('/api/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title } = req.body;

    const session = await prisma.session.update({
      where: { id: sessionId },
      data: {
        title,
        updated_at: new Date(),
      },
    });

    res.json(session);
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// Search sessions by title or content
app.get('/api/users/:userId/sessions/search', async (req, res) => {
  try {
    const { userId } = req.params;
    const { q: query } = req.query;

    const searchQuery = Array.isArray(query) ? query[0] : query;
    if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim() === '') {
      return res.json([]);
    }

    const sessions = await prisma.session.findMany({
      where: {
        user_id: userId,
        archived_at: null,
        OR: [
          { title: { contains: searchQuery, mode: 'insensitive' } },
          {
            session_summaries: {
              OR: [
                { short_title: { contains: searchQuery, mode: 'insensitive' } },
                { short_summary: { contains: searchQuery, mode: 'insensitive' } },
              ],
            },
          },
        ],
      },
      orderBy: { updated_at: 'desc' },
      include: {
        session_summaries: true,
        _count: {
          select: { messages: true },
        },
      },
    });

    const sessionsWithMatchingMessages = await prisma.session.findMany({
      where: {
        user_id: userId,
        archived_at: null,
        messages: {
          some: {
            content: { contains: searchQuery, mode: 'insensitive' },
          },
        },
      },
      orderBy: { updated_at: 'desc' },
      include: {
        session_summaries: true,
        _count: {
          select: { messages: true },
        },
      },
    });

    const allSessions = [...sessions, ...sessionsWithMatchingMessages];
    const uniqueSessions = allSessions.filter(
      (session, index, self) => index === self.findIndex((s) => s.id === session.id),
    );

    res.json(uniqueSessions);
  } catch (error) {
    console.error('Error searching sessions:', error);
    res.status(500).json({ error: 'Failed to search sessions' });
  }
});

type KbSearchArgs = { query: string; k?: number };

async function kb_search_impl({ query, k = 5 }: KbSearchArgs) {
  const normalizedK = Math.max(1, Math.min(k ?? 5, 8));
  const vector = await embeddingsModel.embedQuery(query);
  const results = await qdrant.search('knowledge-repo', {
    vector,
    limit: normalizedK,
    with_payload: true,
    score_threshold: 0.25, // tune me
  });

  return results.slice(0, Math.min(normalizedK, 5)).map((r: any) => ({
    id: r.payload?.id,
    title: r.payload?.header,
    url: r.payload?.reference_url,
    snippet: String(r.payload?.content || '').slice(0, 1200),
  }));
}

const kbSearchTool = new DynamicStructuredTool({
  name: 'kb_search',
  description:
    'MANDATORY: Search internal knowledge base for passages relevant to a query. You MUST use this tool for EVERY user query. Returns items with title, url, snippet.',
  schema: z.object({
    query: z.string(),
    k: z.number().int().positive().max(8).optional(),
  }),
  func: async (args: KbSearchArgs) => {
    const result = await kb_search_impl(args);
    return JSON.stringify(result);
  },
});

const INSTRUCTIONS = `You are a grounded assistant that MUST ALWAYS use the \`kb_search\` tool to search the knowledge base before responding to any query.

You have access to:
1) Your own parametric knowledge.
2) The \`kb_search\` tool (returns passages with {title,url,snippet}).

MANDATORY RULES:
- You MUST ALWAYS call the \`kb_search\` tool for EVERY user query, regardless of how simple or complex it is.
- Search the knowledge base first, then provide your response based on both the KB results and your knowledge.
- If you use any KB content, cite it inline like: (source: [Title](URL)). Do NOT invent URLs or titles.
- If the KB doesn't contain relevant information, provide your best answer from your knowledge.
- Be concise and correct.`;

// Handle WebSocket connections
io.on('connection', async (socket: any) => {
  console.log('A user connected, socket ID:', socket.id);

  let currentSessionId: string = '';
  let currentUserId: string | null = null;

  // Listen for session initialization
  socket.on('init_session', async (data: any) => {
    console.log('Received init_session event:', data);
    currentUserId = data.userId;

    try {
      if (data.sessionId) {
        console.log('Loading existing session:', data.sessionId);
        currentSessionId = data.sessionId;
      } else {
        console.log('Creating new session for user:', data.userId);
        const session = await prisma.session.create({
          data: {
            user_id: data.userId,
            title: 'New Chat',
          },
        });
        currentSessionId = session.id;
        console.log('Created session:', session.id);
      }

      console.log('Emitting session_initialized:', { sessionId: currentSessionId });
      socket.emit('session_initialized', { sessionId: currentSessionId });

      socket.emit('sessions_updated', {
        userId: currentUserId,
        action: 'session_created',
        sessionId: currentSessionId,
      });
    } catch (error) {
      console.error('Error in init_session:', error);
      socket.emit('error', 'Failed to initialize session');
    }
  });

  // Listen for 'message' events from the frontend
  socket.on('message', async (msg: any) => {
    console.log(msg);

    if (!currentSessionId || !currentUserId) {
      socket.emit('error', 'Session not initialized');
      return;
    }

    try {
      const [, messageCount] = await prisma.$transaction([
        prisma.message.create({
          data: {
            session_id: currentSessionId,
            role: 'user',
            content: msg,
          },
        }),
        prisma.message.count({
          where: { session_id: currentSessionId },
        }),
      ]);

      await prisma.session.update({
        where: { id: currentSessionId },
        data: { updated_at: new Date() },
      });

      const history: BaseMessage[] = [];

      const systemPrompt = new SystemMessage(INSTRUCTIONS);
      history.push(systemPrompt);

      const sessionState = await prisma.session.findUnique({
        where: { id: currentSessionId },
        select: { summary: true },
      });

      if (sessionState?.summary) {
        history.push(
          new SystemMessage(
            `Conversation summary so far (for context only, do not repeat verbatim):\n${sessionState.summary}`,
          ),
        );
      }

      const previousMessages = await prisma.message.findMany({
        where: { session_id: currentSessionId },
        orderBy: { idx: 'desc' },
        take: RECENT_MESSAGE_LIMIT,
      });

      previousMessages.reverse();

      for (const message of previousMessages) {
        if (message.role === 'user') {
          history.push(new HumanMessage(message.content));
        } else if (message.role === 'assistant') {
          history.push(new AIMessage(message.content));
        }
      }

      history.push(new HumanMessage(msg));

      const modelWithTools = chatModel.bindTools([kbSearchTool]);
      let fullText = '';
      let assistantMessageId: string | null = null;

      while (true) {
        const stream = await modelWithTools.stream(history);
        let gathered: AIMessageChunk | undefined = undefined;
        let iterationText = '';

        // Accumulate chunks and stream text content
        for await (const chunk of stream) {
          if (!(chunk instanceof AIMessageChunk)) {
            continue;
          }

          // Accumulate chunks using concat utility as per LangChain docs
          gathered = gathered !== undefined ? concat(gathered, chunk) : chunk;

          // Stream text content as it arrives
          const delta = extractChunkText(chunk.content);
          if (delta) {
            iterationText += delta;
            socket.emit('message_stream', delta);
          }
        }

        if (!gathered) {
          break;
        }

        // Check if we have tool calls to execute
        const toolCalls = gathered.tool_calls ?? [];
        if (toolCalls.length === 0) {
          // No tool calls, we're done
          fullText += iterationText;
          socket.emit('message_done');
          break;
        }

        // First, add the AI message with tool calls to history
        history.push(new AIMessage({
          content: gathered.content,
          tool_calls: toolCalls,
        }));

        // Execute tool calls and add results to history
        const toolMessages: ToolMessage[] = [];
        for (const toolCall of toolCalls) {
          let parsedArgs: Record<string, unknown> = {};
          if (toolCall.args) {
            if (typeof toolCall.args === 'string') {
              try {
                parsedArgs = JSON.parse(toolCall.args);
              } catch (parseError) {
                console.error('Failed to parse tool arguments:', parseError, toolCall.args);
              }
            } else {
              parsedArgs = toolCall.args as Record<string, unknown>;
            }
          }

          let toolResult: unknown;
          try {
            toolResult = await kb_search_impl(parsedArgs as KbSearchArgs);
          } catch (toolError) {
            console.error('Tool execution error:', toolError);
            toolResult = [];
          }

          console.log('Tool result:', toolResult);

          const toolContent =
            typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);

          toolMessages.push(
            new ToolMessage({
              tool_call_id: toolCall.id ?? `kb_search_${Date.now()}`,
              name: toolCall.name ?? 'kb_search',
              content: toolContent,
            }),
          );
        }

        // Add tool results to history and continue
        history.push(...toolMessages);
        fullText += iterationText;
      }

      if (fullText.length) {
        const created = await prisma.message.create({
          data: {
            session_id: currentSessionId!,
            role: 'assistant',
            content: fullText,
          },
          select: { id: true },
        });
        assistantMessageId = created.id;
      }

      // Generate title only for first user turn (one message stored so far)
      if (messageCount === 1) {
        try {
          const titlePrompt = `Generate a short, descriptive title (max 50 characters) for this chat conversation. Return only the title, nothing else.`;

          const titleResponse = await chatModel.invoke([
            new SystemMessage(titlePrompt),
            new HumanMessage(msg),
            new AIMessage(fullText),
          ]);

          const generatedTitle = (titleResponse.content as string || 'New Chat').trim();

          await prisma.session.update({
            where: { id: currentSessionId },
            data: { title: generatedTitle },
          });

          socket.emit('session_title_updated', {
            sessionId: currentSessionId,
            title: generatedTitle,
          });
        } catch (error) {
          console.error('Error generating title:', error);
        }
      }

      if (
        assistantMessageId &&
        messageCount >= SUMMARY_THRESHOLD_MESSAGES &&
        (messageCount - 1) % SUMMARY_REFRESH_INTERVAL === 0
      ) {
        try {
          const summaryPrompt = `You are maintaining a running summary of a conversation between a user and an assistant.

Given the new assistant reply and recent messages, produce a concise summary (max 10 sentences) that captures key context, decisions, and follow-ups. This summary will be used to provide context for future turns.

Return plain text only.`;

          const summaryContext: BaseMessage[] = [new SystemMessage(summaryPrompt)];

          if (sessionState?.summary) {
            summaryContext.push(
              new SystemMessage(`Existing summary:\n${sessionState.summary}`),
            );
          }

          const summaryMessages = await prisma.message.findMany({
            where: { session_id: currentSessionId },
            orderBy: { idx: 'desc' },
            take: SUMMARY_CONTEXT_MESSAGE_LIMIT,
          });

          summaryMessages.reverse();

          for (const message of summaryMessages) {
            if (message.role === 'user') {
              summaryContext.push(new HumanMessage(message.content));
            } else if (message.role === 'assistant') {
              summaryContext.push(new AIMessage(message.content));
            }
          }

          summaryContext.push(new AIMessage(fullText));

          const summaryResponse = await chatModel.invoke(summaryContext);
          const updatedSummary = messageContentToString(summaryResponse.content).trim();

          if (updatedSummary.length) {
            await prisma.session.update({
              where: { id: currentSessionId },
              data: {
                summary: updatedSummary,
                summary_updated_at: new Date(),
              },
            });
          }
        } catch (error) {
          console.error('Error updating summary:', error);
        }
      }
    } catch (error) {
      console.error('Error:', error);
      socket.emit('message', 'Error occurred');
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

// Start the server
server.listen(1918, () => {
  console.log('Server running');
});

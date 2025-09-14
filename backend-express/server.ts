import express from 'express';
import { Server } from 'socket.io';
import OpenAI from 'openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import { Server as HttpServer } from 'http';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';

// Load environment variables from .env file
dotenv.config();

// Configure JSON serialization to handle BigInt
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const openai = new OpenAI();
const prisma = new PrismaClient();
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
  apiKey: process.env.QDRANT_API_KEY,
});

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

/**
 * Instructions sent with each Responses API call.
 */
const INSTRUCTIONS = `You are a helpful assistant that can answer questions based on the content of the current chat session
and the provided knowledge base context. Determine by yourself the relevant of the knowledge base context on the user questions,
and answer accordingly.

IMPORTANT FORMATTING RULES:
- When referencing information from the knowledge base, cite sources inline using this format: (source: [Source Title](source_url))
- Make the source title clickable by wrapping it in square brackets followed by the URL in parentheses
- Do NOT include file names in the citations, only the source title and URL
- Example: "According to [Microservices Patterns](https://example.com/microservices-patterns), the best approach is..."
- Use the provided source URLs exactly as given in the context`;

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Function to search Qdrant for relevant knowledge
async function searchKnowledge(query: string, limit: number): Promise<any[]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });

    const queryEmbedding = response.data[0].embedding;

    const results = await qdrant.search('knowledge-repo', {
      vector: queryEmbedding,
      limit: limit,
      with_payload: true,
    });

    return results;
  } catch (error) {
    console.error('Error searching knowledge base:', error);
    return [];
  }
}

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

// Handle WebSocket connections
io.on('connection', async (socket: any) => {
  console.log('A user connected, socket ID:', socket.id);

  let currentSessionId: string = '';
  let currentUserId: string | null = null;

  // Ensure a Conversation exists for the session; create & persist conv_ id if missing
  async function ensureConversationForSession(sessionId: string) {
    const row = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { openai_conversation_id: true, user_id: true },
    });

    if (row?.openai_conversation_id?.startsWith('conv_')) {
      return row.openai_conversation_id;
    }

    const conv = await openai.conversations.create({
      // optional metadata tags are handy for debugging in the dashboard
      metadata: { session_id: sessionId, user_id: row?.user_id || currentUserId || '' },
    });

    await prisma.session.update({
      where: { id: sessionId },
      data: { openai_conversation_id: conv.id }, // conv_...
    });

    return conv.id;
  }

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

      // Ensure we have a conv_ id aligned with this session
      try {
        await ensureConversationForSession(currentSessionId);
      } catch (e) {
        console.error('Failed to ensure conversation:', e);
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
      // Save user message
      await prisma.message.create({
        data: {
          session_id: currentSessionId,
          role: 'user',
          content: msg,
        },
      });

      // Count messages in this session
      const messageCount = await prisma.message.count({
        where: { session_id: currentSessionId },
      });

      // Update session timestamp
      await prisma.session.update({
        where: { id: currentSessionId },
        data: { updated_at: new Date() },
      });

      // Ensure conv_ id
      const convId = await ensureConversationForSession(currentSessionId);

      // RAG: search knowledge base
      const knowledgeResults = await searchKnowledge(msg, 10);

      // Build context
      let knowledgeContext = '';
      if (knowledgeResults.length > 0) {
        knowledgeContext = 'Info from knowledge base (might be relevant or not):\n\n';
        knowledgeResults.forEach((result: any, index: number) => {
          const payload = result.payload;
          const sourceLink = `[${payload.header}](${payload.reference_url})`;
          knowledgeContext += `${index + 1}. ${sourceLink}\n${payload.content}\n\n`;
        });
      }

      const contextualMessage = knowledgeContext ? `${knowledgeContext}\n\nUser question: ${msg}` : msg;

      /**
       * Responses API with a pre-created Conversation
       * - Always pass conversation: convId
       * - stream: true for SSE deltas
       * - No need for store:true when using conversations (conversation keeps state)
       */
      const stream = await openai.responses.create({
        model: 'gpt-4o-mini',
        instructions: INSTRUCTIONS,
        input: contextualMessage,
        conversation: convId,  // <-- the important bit
        stream: true,
        // temperature: 0.2, // optional
      });

      let fullText = '';
      let sawDelta = false;

      for await (const event of stream as any) {
        if (event.type === 'response.output_text.delta') {
          const delta = event.delta ?? '';
          if (delta) {
            sawDelta = true;
            fullText += delta;
            socket.emit('message_stream', delta);
          }
        } else if (event.type === 'response.completed') {
          socket.emit('message_done');
        } else if (event.type === 'response.error') {
          socket.emit('message', 'Model error.');
        }
      }

      // Only send fallback 'message' if we never streamed deltas
      if (!sawDelta && fullText.length) {
        socket.emit('message', fullText);
      }

      // Save assistant reply
      if (fullText.length) {
        await prisma.message.create({
          data: {
            session_id: currentSessionId!,
            role: 'assistant',
            content: fullText,
          },
        });
      }

      // Generate title only for first user turn (one message stored so far)
      if (messageCount === 1) {
        try {
          const titleResp = await openai.responses.create({
            model: 'gpt-4o-mini',
            instructions:
              "Generate a short, descriptive title (max 50 characters) for this chat conversation based on the user's first message. Return only the title, nothing else.",
            input: msg,
            conversation: convId,
          });

          const generatedTitle = (titleResp.output_text || 'New Chat').trim();

          await prisma.session.update({
            where: { id: currentSessionId },
            data: { title: generatedTitle },
          });

          socket.emit('session_title_updated', {
            sessionId: currentSessionId,
            title: generatedTitle,
          });

          socket.emit('sessions_updated', {
            userId: currentUserId,
            action: 'title_updated',
            sessionId: currentSessionId,
            title: generatedTitle,
          });
        } catch (error) {
          console.error('Error generating title:', error);
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

import express from 'express';
import {Server} from 'socket.io';
import OpenAI from 'openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import {Server as HttpServer} from 'http';
import { PrismaClient } from './generated/prisma/index.js';
import cors from 'cors';

// Load environment variables from .env file
dotenv.config();

// Configure JSON serialization to handle BigInt
(BigInt.prototype as any).toJSON = function() {
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
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors({
  origin: '*', // Allow all origins for development
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Create a simple assistant for general conversation
let assistant = await openai.beta.assistants.create({
  name: 'hungcq knowledge repo assistant',
  instructions: `You are a helpful assistant that can answer questions based on the provided knowledge base context. When you have access to relevant information from the knowledge base, use it to provide accurate and helpful answers. 

IMPORTANT FORMATTING RULES:
- When referencing information from the knowledge base, cite sources inline using this format: (source: [Source Title](source_url))
- Make the source title clickable by wrapping it in square brackets followed by the URL in parentheses
- Do NOT include file names in the citations, only the source title and URL
- Example: "According to [Microservices Patterns](https://example.com/microservices-patterns), the best approach is..."
- Use the provided source URLs exactly as given in the context`,
  model: 'gpt-4o-mini',
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Test socket connection endpoint
app.get('/test-socket', (req, res) => {
  res.status(200).json({ 
    message: 'Socket server is running',
    connectedClients: io.engine.clientsCount,
    timestamp: new Date().toISOString() 
  });
});

// Function to search Qdrant for relevant knowledge
async function searchKnowledge(query: string, limit: number): Promise<any[]> {
  try {
    // Generate embedding for the query
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });
    
    const queryEmbedding = response.data[0].embedding;
    
    // Search Qdrant
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
        archived_at: null 
      },
      orderBy: { updated_at: 'desc' },
      include: {
        session_summaries: true,
        _count: {
          select: { messages: true }
        }
      }
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
      orderBy: { idx: 'asc' }
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
        title: title || 'New Chat'
      }
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
        updated_at: new Date()
      }
    });
    
    res.json(session);
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// Update session summary
app.put('/api/sessions/:sessionId/summary', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { short_title, short_summary } = req.body;
    
    const sessionSummary = await prisma.sessionSummary.upsert({
      where: { session_id: sessionId },
      update: {
        short_title,
        short_summary,
        updated_at: new Date()
      },
      create: {
        session_id: sessionId,
        short_title,
        short_summary
      }
    });
    
    res.json(sessionSummary);
  } catch (error) {
    console.error('Error updating session summary:', error);
    res.status(500).json({ error: 'Failed to update session summary' });
  }
});

// Search sessions by title or content
app.get('/api/users/:userId/sessions/search', async (req, res) => {
  try {
    const { userId } = req.params;
    const { q: query } = req.query;
    
    // Ensure query is a string
    const searchQuery = Array.isArray(query) ? query[0] : query;
    if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim() === '') {
      return res.json([]);
    }
    
    // Search in session titles and summaries
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
                { short_summary: { contains: searchQuery, mode: 'insensitive' } }
              ]
            }
          }
        ]
      },
      orderBy: { updated_at: 'desc' },
      include: {
        session_summaries: true,
        _count: {
          select: { messages: true }
        }
      }
    });
    
    // Also search in message content
    const sessionsWithMatchingMessages = await prisma.session.findMany({
      where: {
        user_id: userId,
        archived_at: null,
        messages: {
          some: {
            content: { contains: searchQuery, mode: 'insensitive' }
          }
        }
      },
      orderBy: { updated_at: 'desc' },
      include: {
        session_summaries: true,
        _count: {
          select: { messages: true }
        }
      }
    });
    
    // Combine and deduplicate results
    const allSessions = [...sessions, ...sessionsWithMatchingMessages];
    const uniqueSessions = allSessions.filter((session, index, self) => 
      index === self.findIndex(s => s.id === session.id)
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

  let thread: any;
  let currentSessionId: string = '';
  let currentUserId: string | null = null;

  // Listen for session initialization
  socket.on('init_session', async (data: any) => {
    thread = await openai.beta.threads.create();
    console.log('Received init_session event:', data);
    currentUserId = data.userId;
    
    try {
      if (data.sessionId) {
        // Load existing session
        console.log('Loading existing session:', data.sessionId);
        currentSessionId = data.sessionId;
      } else {
        // Create new session
        console.log('Creating new session for user:', data.userId);
        const session = await prisma.session.create({
          data: {
            user_id: data.userId,
            title: 'New Chat'
          }
        });
        currentSessionId = session.id;
        console.log('Created session:', session.id);
      }
      
      console.log('Emitting session_initialized:', { sessionId: currentSessionId });
      socket.emit('session_initialized', { sessionId: currentSessionId });
      
      // Emit session list update to refresh the sidebar
      socket.emit('sessions_updated', { 
        userId: currentUserId,
        action: 'session_created',
        sessionId: currentSessionId
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
      // Save user message to database
      await prisma.message.create({
        data: {
          session_id: currentSessionId,
          role: 'user',
          content: msg
        }
      });

      // Check if this is the first message in the session
      const messageCount = await prisma.message.count({
        where: { session_id: currentSessionId }
      });

      // Update session timestamp
      await prisma.session.update({
        where: { id: currentSessionId },
        data: { updated_at: new Date() }
      });

      // Search knowledge base using Qdrant
      const knowledgeResults = await searchKnowledge(msg, 10);
      
      // Build context from knowledge results
      let knowledgeContext = '';
      let sources: any[] = [];
      
      if (knowledgeResults.length > 0) {
        knowledgeContext = 'Based on the knowledge base, here is relevant information:\n\n';
        
        knowledgeResults.forEach((result, index) => {
          const payload = result.payload;
          const sourceLink = `[${payload.header}](${payload.reference_url})`;
          knowledgeContext += `${index + 1}. ${sourceLink}\n${payload.content}\n\n`;
          sources.push({
            title: payload.header,
            url: payload.reference_url,
            file: payload.file_name
          });
        });
        
        knowledgeContext += 'Please use this information to answer the user\'s question. When referencing information, cite the source inline using the format [Source Title](source_url) and make sure to use the exact URLs provided above.';
      }

      // Create a message with context for the assistant
      const contextualMessage = knowledgeContext 
        ? `${knowledgeContext}\n\nUser question: ${msg}`
        : msg;

      // Send contextual message to OpenAI
      const message = await openai.beta.threads.messages.create(
          thread.id,
          {
            role: 'user',
            content: contextualMessage,
          },
      );

      openai.beta.threads.runs.stream(thread.id, {
        assistant_id: assistant.id,
      }).
          on('textCreated', () => {}).
          on('toolCallCreated',
              (event: any) => console.log('assistant ' + event.type)).
          on('messageDone', async (event: any) => {
            if (event.content[0].type !== 'text') {
              return;
            }
            const {text} = event.content[0];
            let output = text.value;
            
            socket.emit('message', output);
            
            // Save assistant message to database
            await prisma.message.create({
              data: {
                session_id: currentSessionId!,
                role: 'assistant',
                content: output
              }
            });

            // Generate title for the session if this is the first message
            if (messageCount === 1) {
              try {
                const titleResponse = await openai.chat.completions.create({
                  model: 'gpt-4o-mini',
                  messages: [
                    {
                      role: 'system',
                      content: 'Generate a short, descriptive title (max 50 characters) for this chat conversation based on the user\'s first message. Return only the title, nothing else.'
                    },
                    {
                      role: 'user',
                      content: msg
                    }
                  ],
                  max_tokens: 50,
                  temperature: 0.7
                });

                const generatedTitle = titleResponse.choices[0].message.content?.trim() || 'New Chat';
                
                // Update session title
                await prisma.session.update({
                  where: { id: currentSessionId },
                  data: { title: generatedTitle }
                });

                // Emit title update to frontend
                socket.emit('session_title_updated', { 
                  sessionId: currentSessionId, 
                  title: generatedTitle 
                });

                // Emit session list update to refresh the sidebar
                socket.emit('sessions_updated', { 
                  userId: currentUserId,
                  action: 'title_updated',
                  sessionId: currentSessionId,
                  title: generatedTitle
                });
              } catch (error) {
                console.error('Error generating title:', error);
              }
            }
          });
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

import {Socket} from 'socket.io';
import {run} from '@openai/agents';
import {
  prisma,
  RECENT_MESSAGE_LIMIT,
  SUMMARY_THRESHOLD_MESSAGES,
  SUMMARY_REFRESH_INTERVAL,
  SUMMARY_CONTEXT_MESSAGE_LIMIT, CHAT_MODEL, openai,
} from '../config/index.js';
import {routingAgent} from '../agents/routingAgent.js';
import {GeminiKnowledgeAgent} from "../agents/geminiKnowledgeAgent.js";

interface Message {
  role: string;
  content: string;
}

function buildMessageHistory(messages: Message[]): string {
  return messages
    .map((message) => {
      if (message.role === 'user') return `User: ${message.content}`;
      if (message.role === 'assistant') return `Assistant: ${message.content}`;
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function formatInputWithHistory(history: string, currentMessage: string): string {
  return history ? `${history}\n\nUser: ${currentMessage}` : currentMessage;
}

async function streamAgentResponse(stream: any, socket: Socket): Promise<string> {
  let fullText = '';

  for await (const event of stream) {
    if (event.type === 'raw_model_stream_event') {
      const data = event.data;
      if (data.type === 'output_text_delta' && data.delta) {
        fullText += data.delta;
        socket.emit('message_stream', data.delta);
      }
    }
  }

  await stream.completed;
  socket.emit('message_done');

  return fullText;
}

async function generateSessionTitle(
  userMessage: string,
  assistantResponse: string,
): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Generate a short, descriptive title (max 8 words) for this chat conversation. Return only the title, nothing else.',
        },
        {
          role: 'user', content: `Below are the content of the conversation: 
          User: ${userMessage}\n\n
          Assistant: ${assistantResponse}`
        },
      ],
    });

    return response.choices[0]?.message?.content?.trim() || 'New Chat';
  } catch (error) {
    console.error('Error generating title:', error);
    return 'New Chat';
  }
}

async function updateSessionSummary(
  sessionId: string,
  existingSummary: string | null,
  latestResponse: string,
): Promise<void> {
  try {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: `You are maintaining a running summary of a conversation between a user and an assistant.

        Given the new assistant reply and recent messages, produce a concise summary (max 10 sentences) that captures key context, decisions, and follow-ups. This summary will be used to provide context for future turns.

        Return plain text only.`,
      },
    ];

    if (existingSummary) {
      messages.push({
        role: 'system',
        content: `Existing summary:\n${existingSummary}`,
      });
    }

    const contextMessages = await prisma.message.findMany({
      where: {session_id: sessionId},
      orderBy: {idx: 'desc'},
      take: SUMMARY_CONTEXT_MESSAGE_LIMIT,
    });

    contextMessages.reverse();

    for (const msg of contextMessages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    messages.push({
      role: 'assistant',
      content: latestResponse,
    });

    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages,
    });

    const summary = response.choices[0]?.message?.content?.trim();

    if (summary) {
      await prisma.session.update({
        where: {id: sessionId},
        data: {
          summary,
          summary_updated_at: new Date(),
        },
      });
    }
  } catch (error) {
    console.error('Error updating summary:', error);
  }
}

async function initializeSession(userId: string, sessionId?: string): Promise<string> {
  if (sessionId) {
    console.log('Loading existing session:', sessionId);
    return sessionId;
  }

  console.log('Creating new session for user:', userId);
  const session = await prisma.session.create({
    data: {
      user_id: userId,
      title: 'New Chat',
    },
  });

  console.log('Created session:', session.id);
  return session.id;
}

async function handleUserMessage(
  socket: Socket,
  sessionId: string,
  message: string,
  userId: string,
): Promise<void> {
  // Save user message and get message count
  const [, messageCount] = await prisma.$transaction([
    prisma.message.create({
      data: {
        session_id: sessionId,
        role: 'user',
        content: message,
      },
    }),
    prisma.message.count({
      where: {session_id: sessionId},
    }),
  ]);

  // Update session timestamp
  await prisma.session.update({
    where: {id: sessionId},
    data: {updated_at: new Date()},
  });

  // Load session state and history
  const [sessionState, previousMessages] = await Promise.all([
    prisma.session.findUnique({
      where: {id: sessionId},
      select: {summary: true},
    }),
    prisma.message.findMany({
      where: {session_id: sessionId},
      orderBy: {idx: 'desc'},
      take: RECENT_MESSAGE_LIMIT,
    }),
  ]);

  previousMessages.reverse();

  // Build input with history
  const history = buildMessageHistory(previousMessages);
  const input = formatInputWithHistory(history, message);

  let assistantResponse = '';

  if (userId === process.env.SECRET_USER_ID) {
    // Run routing agent with session context and handle handoffs
    let result = await run(routingAgent, input, {
      stream: true,
      context: {
        summary: sessionState?.summary || null,
      },
    });
    assistantResponse = await streamAgentResponse(result, socket);
  } else {
    const agent = new GeminiKnowledgeAgent({summary: sessionState?.summary || null});
    // const res = await agent.chat(input);
    // socket.emit('message_stream', res)
    // assistantResponse = res;
    const stream = agent.chatStream(input)

    for await (const event of stream) {
      socket.emit('message_stream', event);
      assistantResponse += event;
    }

    socket.emit('message_done');
  }

  // Save assistant response
  if (assistantResponse.length > 0) {
    await prisma.message.create({
      data: {
        session_id: sessionId,
        role: 'assistant',
        content: assistantResponse,
      },
    });
  }

  // Generate title for first message
  if (messageCount === 1) {
    const title = await generateSessionTitle(message, assistantResponse);
    await prisma.session.update({
      where: {id: sessionId},
      data: {title},
    });

    socket.emit('session_title_updated', {
      sessionId,
      title,
    });
  }

  // Update summary periodically
  const shouldUpdateSummary =
    assistantResponse.length > 0 &&
    messageCount >= SUMMARY_THRESHOLD_MESSAGES &&
    (messageCount - 1) % SUMMARY_REFRESH_INTERVAL === 0;

  if (shouldUpdateSummary) {
    await updateSessionSummary(sessionId, sessionState?.summary || null, assistantResponse);
  }
}

export function setupChatHandler(socket: Socket): void {
  let currentSessionId = '';
  let currentUserId: string | null = null;

  // Initialize session
  socket.on('init_session', async (data: { userId: string; sessionId?: string }) => {
    console.log('Received init_session event:', data);
    currentUserId = data.userId;

    try {
      currentSessionId = await initializeSession(data.userId, data.sessionId);

      socket.emit('session_initialized', {sessionId: currentSessionId});
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

  // Handle user messages
  socket.on('message', async (message: string) => {
    console.log('Received message:', message);

    if (!currentSessionId || !currentUserId) {
      socket.emit('error', 'Session not initialized');
      return;
    }

    try {
      await handleUserMessage(socket, currentSessionId, message, currentUserId);
    } catch (error) {
      console.error('Error handling message:', error);
      socket.emit('error', 'Error occurred while processing message');
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
}

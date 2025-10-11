import { Socket } from 'socket.io';
import { AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { concat } from '@langchain/core/utils/stream';
import { chatModel, prisma, INSTRUCTIONS, RECENT_MESSAGE_LIMIT, SUMMARY_THRESHOLD_MESSAGES, SUMMARY_REFRESH_INTERVAL, SUMMARY_CONTEXT_MESSAGE_LIMIT } from '../config/index.js';
import { kbSearchTool, kb_search_impl, KbSearchArgs } from '../tools/kbSearch.js';
import { extractChunkText, messageContentToString } from '../utils/messageUtils.js';

export function setupChatHandler(socket: Socket) {
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
}

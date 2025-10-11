import { Router, type Router as ExpressRouter } from 'express';
import { prisma } from '../config/index.js';

export const sessionRouter: ExpressRouter = Router();

// Get all sessions for a user
sessionRouter.get('/users/:userId/sessions', async (req, res) => {
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
sessionRouter.get('/sessions/:sessionId/messages', async (req, res) => {
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
sessionRouter.post('/users/:userId/sessions', async (req, res) => {
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
sessionRouter.put('/sessions/:sessionId', async (req, res) => {
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
sessionRouter.get('/users/:userId/sessions/search', async (req, res) => {
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
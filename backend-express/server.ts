import express from 'express';
import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import cors from 'cors';
import { sessionRouter } from './src/routes/sessions.js';
import { setupChatHandler } from './src/handlers/chatHandler.js';

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
app.use('/api', sessionRouter);

// Handle WebSocket connections
io.on('connection', async (socket: any) => {
  console.log('A user connected, socket ID:', socket.id);
  setupChatHandler(socket);
});

// Start the server
server.listen(1918, () => {
  console.log('Server running');
});

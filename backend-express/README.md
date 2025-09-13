# Chat History Implementation

This implementation adds message storage and chat history functionality to the Knowledge Repo RAG Chatbot.

## Features

### Backend (Express Server)
- **Message Storage**: All chat messages are stored in PostgreSQL using Prisma ORM
- **Session Management**: Each chat conversation is stored as a session with metadata
- **API Endpoints**:
  - `GET /api/users/:userId/sessions` - Get all sessions for a user
  - `GET /api/sessions/:sessionId/messages` - Get messages for a specific session
  - `POST /api/users/:userId/sessions` - Create a new session
  - `PUT /api/sessions/:sessionId` - Update session title
- **WebSocket Integration**: Messages are automatically saved when sent/received

### Frontend (React App)
- **Chat History Sidebar**: Left-hand side panel showing all previous conversations
- **User ID Routing**: Access different user contexts via URL path (e.g., `/user123`)
- **Session Management**: Click on any previous chat to continue the conversation
- **New Chat Button**: Start fresh conversations
- **Real-time Updates**: Messages are saved and loaded in real-time

## Usage

### Starting the Application

1. **Backend Setup**:
   ```bash
   cd backend-express
   npm install
   # Make sure your DATABASE_URL is set in .env
   npm run build
   npm start
   ```

2. **Frontend Setup**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

### Accessing Different Users

The application uses URL-based user identification:
- Default user: `http://localhost:5173/` (or any path without a user ID)
- Specific user: `http://localhost:5173/user123`
- Another user: `http://localhost:5173/alice`

### Database Schema

The implementation uses the following tables:
- `sessions`: Stores chat sessions with user_id, title, timestamps
- `messages`: Stores individual messages with role, content, session_id
- `session_summaries`: Optional summaries for quick reference

### API Examples

```bash
# Get all sessions for user "alice"
curl http://localhost:1918/api/users/alice/sessions

# Get messages for a specific session
curl http://localhost:1918/api/sessions/{session-id}/messages

# Create a new session
curl -X POST http://localhost:1918/api/users/alice/sessions \
  -H "Content-Type: application/json" \
  -d '{"title": "My New Chat"}'
```

## Architecture

- **Backend**: Express.js with Socket.IO for real-time communication
- **Database**: PostgreSQL with Prisma ORM
- **Frontend**: React with Socket.IO client
- **Real-time**: WebSocket connections for instant message delivery
- **Storage**: Persistent message storage with session management

The implementation provides a ChatGPT-like experience with persistent chat history and user-specific sessions.

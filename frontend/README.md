# Knowledge Repo RAG Chatbot - Frontend

React-based frontend for the Knowledge Repo RAG Chatbot.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` and set your API host:
```
VITE_API_HOST=s://api.knowledge-repo-rag.hungcq.com
```

For local development, use:
```
VITE_API_HOST=://localhost:1918
```

**Note:** The format is without the `http`/`ws` prefix. The application will automatically add `http` for REST calls and `ws` for WebSocket connections.

3. Run development server:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
```

## Environment Variables

- `VITE_API_HOST` - API server host (default: `s://api.knowledge-repo-rag.hungcq.com`)
  - Format: `s://domain.com` for HTTPS/WSS
  - Format: `://domain.com` for HTTP/WS

## Project Structure

```
src/
├── components/       # React components
│   ├── ChatHistory.jsx
│   └── Message.jsx
├── config/          # Configuration
│   └── api.js
├── hooks/           # Custom React hooks
│   └── useSocket.js
├── services/        # API services
│   └── sessionService.js
├── utils/           # Utility functions
│   └── urlUtils.js
├── App.jsx          # Main app component
└── main.jsx         # Entry point
```

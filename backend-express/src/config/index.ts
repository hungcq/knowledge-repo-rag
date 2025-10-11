import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { QdrantClient } from '@qdrant/js-client-rest';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';

// Load environment variables from .env file
dotenv.config();

// Configure JSON serialization to handle BigInt
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Helper function to parse positive integers with fallback
function toPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

// AI Models
export const chatModel = new ChatOpenAI({
  model: process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini',
  temperature: 0.2,
});

export const embeddingsModel = new OpenAIEmbeddings({
  model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
});

// Database clients
export const prisma = new PrismaClient();

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
  apiKey: process.env.QDRANT_API_KEY,
});

// Configuration constants
export const RECENT_MESSAGE_LIMIT = toPositiveInt(process.env.CHAT_RECENT_MESSAGE_LIMIT, 10);
export const SUMMARY_THRESHOLD_MESSAGES = toPositiveInt(process.env.CHAT_SUMMARY_THRESHOLD, 18);
export const SUMMARY_REFRESH_INTERVAL = toPositiveInt(process.env.CHAT_SUMMARY_REFRESH_INTERVAL, 4);
export const SUMMARY_CONTEXT_MESSAGE_LIMIT = toPositiveInt(process.env.CHAT_SUMMARY_CONTEXT_LIMIT, 40);

// AI Instructions
export const INSTRUCTIONS = `You are a grounded assistant that MUST ALWAYS use the \`kb_search\` tool to search the knowledge base before responding to any query.

You have access to:
1) Your own parametric knowledge.
2) The \`kb_search\` tool (returns passages with {title,url,snippet}).

MANDATORY RULES:
- You MUST ALWAYS call the \`kb_search\` tool for EVERY user query, regardless of how simple or complex it is.
- Search the knowledge base first, then provide your response based on both the KB results and your knowledge.
- If you use any KB content, cite it inline like: (source: [Title](URL)). Do NOT invent URLs or titles.
- If the KB doesn't contain relevant information, provide your best answer from your knowledge.
- Be concise and correct.`;
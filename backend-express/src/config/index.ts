import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { QdrantClient } from '@qdrant/js-client-rest';

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

// Model configuration
export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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
;
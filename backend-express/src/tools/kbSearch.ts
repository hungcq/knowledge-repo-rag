import { z } from 'zod';
import { openai, qdrant, EMBEDDING_MODEL } from '../config/index.js';

// Define the schema for OpenAI Agents SDK
const kbSearchSchema = z.object({
  query: z.string().describe('The search query to find relevant knowledge base passages'),
  k: z.number().int().positive().max(8).optional().nullable().describe('Number of results to return (1-8)'),
});

type KbSeachParams = z.infer<typeof kbSearchSchema>;

async function kb_search({ query, k }: KbSeachParams) {
  const normalizedK = Math.max(1, Math.min(k ?? 5, 8));

  // Get embedding using OpenAI client
  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  });

  const vector = embeddingResponse.data[0].embedding;

  const results = await qdrant.search('knowledge-repo', {
    vector,
    limit: normalizedK,
    with_payload: true,
    score_threshold: 0.25, // tune me
  });

  return results.slice(0, Math.min(normalizedK, 5)).map((r: any) => ({
    id: r.payload?.id,
    title: r.payload?.header,
    url: r.payload?.reference_url,
    snippet: String(r.payload?.content || '').slice(0, 1200),
  }));
}

export const kbSearchToolDefinition = {
  name: 'kb_search',
  description:
    'MANDATORY: Search internal knowledge base for passages relevant to a query. You MUST use this tool for EVERY user query. Returns items with title, url, snippet.',
  parameters: kbSearchSchema,
  execute: kb_search,
};
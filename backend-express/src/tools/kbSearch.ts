import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { embeddingsModel, qdrant } from '../config/index.js';

export type KbSearchArgs = { query: string; k?: number };

export async function kb_search_impl({ query, k = 5 }: KbSearchArgs) {
  const normalizedK = Math.max(1, Math.min(k ?? 5, 8));
  const vector = await embeddingsModel.embedQuery(query);
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

export const kbSearchTool = new DynamicStructuredTool({
  name: 'kb_search',
  description:
    'MANDATORY: Search internal knowledge base for passages relevant to a query. You MUST use this tool for EVERY user query. Returns items with title, url, snippet.',
  schema: z.object({
    query: z.string(),
    k: z.number().int().positive().max(8).optional(),
  }),
  func: async (args: KbSearchArgs) => {
    const result = await kb_search_impl(args);
    return JSON.stringify(result);
  },
});
import {z} from 'zod';
import {qdrant} from '../config/index.js';
import {generateTextEmbedding, generateMultimodalEmbedding} from './googleEmbeddings.js';

// Collection names
const TEXT_COLLECTION = 'knowledge-repo-text';
const IMAGE_COLLECTION = 'knowledge-repo-diagrams';

// Define the schema for OpenAI Agents SDK
const kbSearchSchema = z.object({
  query: z.string().describe('The search query to find relevant knowledge base passages and images'),
  k: z.number().int().positive().max(20).describe('Number of results to return (1-20, default: 10)'),
});

type KbSeachParams = z.infer<typeof kbSearchSchema>;

async function kb_search({query, k = 10}: KbSeachParams) {
  // Search both collections in parallel
  const [textResults, imageResults] = await Promise.all([
    // Search text collection with Google text embeddings
    (async () => {
      try {
        const vector = await generateTextEmbedding(query);

        return await qdrant.search(TEXT_COLLECTION, {
          vector,
          limit: k,
          with_payload: true,
          score_threshold: 0.4,
        });
      } catch (error) {
        console.error('Error searching text collection:', error);
        return [];
      }
    })(),

    // Search image collection with Google multimodal embeddings
    (async () => {
      try {
        const embeddings = await generateMultimodalEmbedding(query);
        const vector = embeddings.textEmbedding;

        return await qdrant.search(IMAGE_COLLECTION, {
          vector,
          limit: k,
          with_payload: true,
          score_threshold: 0.4,
        });
      } catch (error) {
        console.error('Error searching image collection:', error);
        return [];
      }
    })(),
  ]);

  // Combine and sort results by score
  const combinedResults = [
    ...textResults.map((r: any) => ({
      ...r,
      collection: 'text',
    })),
    ...imageResults.map((r: any) => ({
      ...r,
      collection: 'image',
    })),
  ]
  // .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  // .slice(0, normalizedK);

  // Format results
  return combinedResults.map((r: any) => ({
    type: r.collection,
    title: r.payload?.header || r.payload?.file_name,
    url: r.collection === TEXT_COLLECTION ?
      r.payload?.file_path :
      r.payload?.file_path.replace('/Users/hungcq/projects/knowledge-repo', 'https://raw.githubusercontent.com/hungcq/knowledge-repo/refs/heads/master'),
    snippet: r.collection === 'text'
      ? String(r.payload?.content || '').slice(0, 1200)
      : r.payload?.section_header || '',
    score: r.score,
    mimeType: r.payload?.mime_type,
  }));
}

export const kbSearchToolDefinition = {
  name: 'kb_search',
  description:
    'MANDATORY: Search internal knowledge base for text passages and images relevant to a query. You MUST use this tool for EVERY user query. Returns items with type (text/image), title, url, snippet, and mimeType (for images).',
  parameters: kbSearchSchema,
  execute: kb_search,
};
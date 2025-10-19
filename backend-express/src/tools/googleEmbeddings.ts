/**
 * Shared Google Cloud embedding generation utilities
 * Used by both the knowledge loader and search tools
 */

import { googleGcloudAuth } from './gcloud-auth.js';

// Google Cloud configuration
const PROJECT_ID = process.env.GCP_PROJECT || "sixth-spot-474818-b3";
const LOCATION = process.env.GCP_LOCATION || "europe-west3";
const TEXT_EMBEDDING_MODEL = "gemini-embedding-001";
const MULTIMODAL_MODEL = "multimodalembedding@001";

/**
 * Generate text embedding using Google's text-embedding-005 model
 * Returns 768-dimensional vector
 */
export async function generateTextEmbedding(text: string): Promise<number[]> {
  const accessToken = await googleGcloudAuth.getValidToken();
  if (!accessToken) throw new Error("Failed to obtain access token.");

  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${TEXT_EMBEDDING_MODEL}:predict`;

  const body = {
    instances: [{ content: text }],
    parameters: { autoTruncate: true }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Text embedding API error ${resp.status}: ${errText}`);
  }

  const json: any = await resp.json();
  const embedding = json.predictions?.[0]?.embeddings?.values ?? [];

  if (embedding.length === 0) {
    throw new Error("Failed to generate text embedding - no values returned");
  }

  return embedding;
}

/**
 * Generate multimodal embedding using Google's multimodalembedding@001 model
 * Returns 1408-dimensional vectors for both text and image inputs
 */
export async function generateMultimodalEmbedding(
  text?: string,
  imageData?: string,
  mimeType?: string
): Promise<{ textEmbedding: number[], imageEmbedding: number[] }> {
  const accessToken = await googleGcloudAuth.getValidToken();
  if (!accessToken) throw new Error("Failed to obtain access token.");

  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MULTIMODAL_MODEL}:predict`;

  const body: any = {
    instances: [
      {
        dimension: 1408,
      },
    ],
  };

  if (text) {
    body.instances[0]['text'] = text;
  }
  if (imageData) {
    body.instances[0]['image'] = { bytesBase64Encoded: imageData, mimeType };
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Multimodal embedding API error ${resp.status}: ${errText}`);
  }

  const json: any = await resp.json();

  const instance = json.predictions?.[0] ?? json[0] ?? {};
  return {
    textEmbedding: instance.textEmbedding ?? [],
    imageEmbedding: instance.imageEmbedding ?? [],
  };
}
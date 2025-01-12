from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from dotenv import load_dotenv

load_dotenv()

model = SentenceTransformer("nomic-ai/nomic-embed-text-v1.5", trust_remote_code=True)

# Initialize the Qdrant client
client = QdrantClient(url="http://localhost:6333")
collection = "knowledge_repo_768"

query = 'search_query: how can I deprecate probably?'
query_embeddings = model.encode([query])
search_result = client.query_points(
    collection_name=collection,
    query=query_embeddings[0],
    with_payload=True,
    limit=10
).points

contexts = [point.payload["doc"].removeprefix("search_document: ") for point in search_result]
context_string = " ".join([doc for doc in contexts])

prompt = f"""Use the following pieces of context to answer the question at the end.
    {context_string}
    Question: {query}
"""

from openai import OpenAI
client = OpenAI()

completion = client.chat.completions.create(
    model="meta-llama/Llama-3.2-1B-Instruct",
    messages=[
        {"role": "developer", "content": "You are a helpful assistant."},
        {"role": "user", "content": prompt}
    ]
)

print(completion.choices[0].message)
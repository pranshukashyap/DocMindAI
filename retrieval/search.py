import json
import numpy as np
from sentence_transformers import SentenceTransformer
import faiss

CHUNKS_PATH = "../ingestion/output_chunks/chunks.json"
EMBEDDINGS_PATH = "embeddings.npy"

model = SentenceTransformer("all-MiniLM-L6-v2")

with open(CHUNKS_PATH, "r", encoding="utf-8") as f:
    chunks = json.load(f)

embeddings = np.load(EMBEDDINGS_PATH)

dimension = embeddings.shape[1]
index = faiss.IndexFlatL2(dimension)

index.add(embeddings)

query = input("Ask a question: ")

query_embedding = model.encode([query])

k = 2
distances, indices = index.search(query_embedding, k)

print("\nRelevant context:\n")

for i in indices[0]:
    print(chunks[i]["text"])
    print("\n---\n")

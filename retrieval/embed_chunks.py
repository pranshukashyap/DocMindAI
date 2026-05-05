import json
from sentence_transformers import SentenceTransformer
import numpy as np

INPUT_PATH = "../ingestion/output_chunks/chunks.json"
OUTPUT_PATH = "embeddings.npy"

model = SentenceTransformer("all-MiniLM-L6-v2")

with open(INPUT_PATH, "r", encoding="utf-8") as f:
    chunks = json.load(f)

texts = [chunk["text"] for chunk in chunks]

embeddings = model.encode(texts)

np.save(OUTPUT_PATH, embeddings)

print(f"✅ Created embeddings for {len(embeddings)} chunks")
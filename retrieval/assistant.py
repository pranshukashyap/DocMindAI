import json
import numpy as np
import faiss
import requests
from sentence_transformers import SentenceTransformer

CHUNKS_PATH = "../ingestion/output_chunks/chunks.json"
EMBEDDINGS_PATH = "embeddings.npy"

model = SentenceTransformer("all-MiniLM-L6-v2")

with open(CHUNKS_PATH, "r", encoding="utf-8") as f:
    chunks = json.load(f)

embeddings = np.load(EMBEDDINGS_PATH)

dimension = embeddings.shape[1]
index = faiss.IndexFlatL2(dimension)
index.add(embeddings)

def retrieve_context(query, k=2):
    query_embedding = model.encode([query])
    distances, indices = index.search(query_embedding, k)

    context = ""
    for i in indices[0]:
        context += chunks[i]["text"] + "\n"

    return context

def ask_llm(question, context):

    prompt = f"""
You are a helpful AI assistant.

Answer the question using ONLY the context below.

Context:
{context}

Question:
{question}
"""

    response = requests.post(
        "http://localhost:11434/api/generate",
        json={
            "model": "llama3",
            "prompt": prompt,
            "stream": False
        }
    )

    return response.json()["response"]

while True:

    question = input("\nAsk your document assistant: ")

    context = retrieve_context(question)

    answer = ask_llm(question, context)

    print("\nAnswer:\n")
    print(answer)
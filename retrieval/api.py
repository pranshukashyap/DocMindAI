import numpy as np
import faiss
import requests
import os
import shutil
import uuid

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from pypdf import PdfReader
from typing import List

# ─────────────────────────────────────────────────────────────
# Optional DOCX support
# ─────────────────────────────────────────────────────────────
try:
    import docx
    DOCX_SUPPORTED = True
except ImportError:
    DOCX_SUPPORTED = False
    print("⚠️  python-docx not installed. DOCX support disabled.")

# ─────────────────────────────────────────────────────────────
# App & CORS
# ─────────────────────────────────────────────────────────────
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────
SESSIONS_DIR = "sessions"
OLLAMA_BASE  = "http://localhost:11434"
os.makedirs(SESSIONS_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────
# Embedding model — loaded ONCE at startup
# ─────────────────────────────────────────────────────────────
print("⏳ Loading embedding model...")
embed_model = SentenceTransformer("all-MiniLM-L6-v2")
print("✅ Embedding model ready.")

# ─────────────────────────────────────────────────────────────
# In-memory session store
# ─────────────────────────────────────────────────────────────
sessions: dict = {}


# ═════════════════════════════════════════════════════════════
# TEXT PROCESSING
# ═════════════════════════════════════════════════════════════

def chunk_text(text: str, chunk_size: int = 400, overlap: int = 80) -> list:
    chunks, start = [], 0
    while start < len(text):
        chunk = text[start: start + chunk_size].strip()
        if chunk:
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


def extract_text_from_pdf(file_path: str) -> str:
    reader = PdfReader(file_path)
    return "\n".join(
        page.extract_text() for page in reader.pages if page.extract_text()
    )


def extract_text_from_docx(file_path: str) -> str:
    if not DOCX_SUPPORTED:
        return ""
    doc = docx.Document(file_path)
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


# ═════════════════════════════════════════════════════════════
# SESSION HELPERS
# ═════════════════════════════════════════════════════════════

def get_session(session_id: str) -> dict:
    if session_id not in sessions:
        sessions[session_id] = {"chunks": [], "embeddings": None, "index": None}
    return sessions[session_id]


def rebuild_index(session: dict):
    if not session["chunks"]:
        return
    embeddings = embed_model.encode(session["chunks"])
    session["embeddings"] = embeddings
    idx = faiss.IndexFlatL2(embeddings.shape[1])
    idx.add(embeddings)
    session["index"] = idx


def retrieve_context(session: dict, query: str, k: int = 4) -> str:
    if session["index"] is None or not session["chunks"]:
        return ""
    k = min(k, len(session["chunks"]))
    _, indices = session["index"].search(embed_model.encode([query]), k)
    return "\n\n".join(session["chunks"][i] for i in indices[0])


# ═════════════════════════════════════════════════════════════
# OLLAMA — TinyLlama
# ═════════════════════════════════════════════════════════════

def get_available_models() -> list:
    try:
        res = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=5)
        return [m["name"] for m in res.json().get("models", [])]
    except Exception:
        return []


def detect_model() -> str:
    """
    Auto-detect tinyllama from installed Ollama models.
    Priority: tinyllama:latest → any tinyllama variant → fallback.
    """
    models = get_available_models()
    print(f"📋 Installed Ollama models: {models}")
    for name in models:
        if name == "tinyllama:latest":
            return "tinyllama:latest"
    for name in models:
        if name.startswith("tinyllama"):
            return name
    # Last resort — return the first installed model if any
    if models:
        print(f"⚠️  No tinyllama found, falling back to: {models[0]}")
        return models[0]
    return "tinyllama:latest"


def ask_llm(question: str, context: str) -> str:
    """
    Call TinyLlama via Ollama.

    TinyLlama 1.1B is fine-tuned with the ChatML / Zephyr chat template:
        <|system|>  …  </s>
        <|user|>    …  </s>
        <|assistant|>

    DO NOT use phi3-style <|end|> tags — they produce empty output on TinyLlama.
    """
    model_name = detect_model()
    print(f"🤖 Sending request to model: {model_name}")

    prompt = (
        "<|system|>\n"
        "You are a helpful AI assistant. "
        "Answer the user's question using ONLY the provided context. "
        "Format your answer clearly with bullet points or numbered lists where appropriate. "
        "Highlight key terms using **double asterisks**. "
        "If the answer is not in the context, say: "
        "\"I couldn't find relevant information in the uploaded documents.\"\n"
        "</s>\n"
        "<|user|>\n"
        f"Context:\n{context}\n\n"
        f"Question: {question}\n"
        "</s>\n"
        "<|assistant|>\n"
    )

    try:
        response = requests.post(
            f"{OLLAMA_BASE}/api/generate",
            json={
                "model":  model_name,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.3,
                    "top_p":       0.9,
                    "num_predict": 512,
                    # Stop tokens for TinyLlama ChatML format
                    "stop": ["</s>", "<|user|>", "<|system|>", "<|assistant|>"],
                },
            },
            timeout=300,  # TinyLlama on CPU can take time on first load
        )

        if response.status_code != 200:
            return f"⚠️ Ollama returned HTTP {response.status_code}: {response.text[:300]}"

        data = response.json()
        print(f"📦 Ollama response keys: {list(data.keys())}")
        print(f"📝 Raw answer preview: {str(data.get('response', ''))[:120]}")

        answer = data.get("response", "").strip()

        if not answer:
            err = data.get("error", "")
            if err:
                return f"⚠️ Ollama error: {err}"
            return (
                "⚠️ TinyLlama returned an empty response.\n"
                "Try running `ollama run tinyllama` in your terminal first "
                "to pre-load the model into memory, then ask again."
            )

        return answer

    except requests.exceptions.ConnectionError:
        return (
            "⚠️ Cannot reach Ollama at localhost:11434.\n"
            "Fix: open a terminal and run `ollama serve`."
        )
    except requests.exceptions.Timeout:
        return (
            "⚠️ TinyLlama timed out (>5 min).\n"
            "Fix: run `ollama run tinyllama` in your terminal first "
            "to pre-load it into RAM, then try again."
        )
    except Exception as e:
        return f"⚠️ Unexpected error: {str(e)}"


# ═════════════════════════════════════════════════════════════
# API ROUTES
# ═════════════════════════════════════════════════════════════

@app.post("/session/new")
def new_session():
    """Create a new isolated chat session."""
    sid = str(uuid.uuid4())
    sessions[sid] = {"chunks": [], "embeddings": None, "index": None}
    return {"session_id": sid}


@app.post("/upload")
async def upload_files(
    session_id: str = Form(...),
    files: List[UploadFile] = File(...),
):
    """Upload one or more PDF / DOCX files into a session's knowledge base."""
    session     = get_session(session_id)
    session_dir = os.path.join(SESSIONS_DIR, session_id)
    os.makedirs(session_dir, exist_ok=True)

    uploaded_names = []
    for file in files:
        ext = file.filename.rsplit(".", 1)[-1].lower()
        if ext not in ("pdf", "docx"):
            continue

        file_path = os.path.join(session_dir, file.filename)
        with open(file_path, "wb") as buf:
            shutil.copyfileobj(file.file, buf)

        text = (
            extract_text_from_pdf(file_path)  if ext == "pdf"  else
            extract_text_from_docx(file_path) if ext == "docx" else ""
        )
        if not text.strip():
            continue

        session["chunks"].extend(chunk_text(text))
        uploaded_names.append(file.filename)

    if uploaded_names:
        rebuild_index(session)

    return {
        "message":      f"Added {len(uploaded_names)} file(s) to knowledge base.",
        "files":        uploaded_names,
        "total_chunks": len(session["chunks"]),
    }


class AskRequest(BaseModel):
    session_id: str
    question:   str


@app.post("/ask")
def ask(req: AskRequest):
    """Ask a question against the session's knowledge base."""
    session = get_session(req.session_id)

    if session["index"] is None:
        return {
            "answer":        "⚠️ No documents uploaded yet. Please upload a PDF or DOCX file first.",
            "context_found": False,
        }

    context = retrieve_context(session, req.question)
    if not context.strip():
        return {
            "answer":        "I couldn't find relevant information in the uploaded documents.",
            "context_found": False,
        }

    answer = ask_llm(req.question, context)
    return {"answer": answer, "context_found": True}


@app.get("/session/{session_id}/docs")
def get_docs(session_id: str):
    session_dir = os.path.join(SESSIONS_DIR, session_id)
    if not os.path.exists(session_dir):
        return {"docs": []}
    return {"docs": os.listdir(session_dir)}


@app.delete("/session/{session_id}")
def delete_session(session_id: str):
    sessions.pop(session_id, None)
    session_dir = os.path.join(SESSIONS_DIR, session_id)
    if os.path.exists(session_dir):
        shutil.rmtree(session_dir)
    return {"message": "Session deleted."}


# ─────────────────────────────────────────────────────────────
# DEBUG — open http://127.0.0.1:8000/debug/ollama in browser
# ─────────────────────────────────────────────────────────────

@app.get("/debug/ollama")
def debug_ollama():
    """Full Ollama diagnostic — reachability, models, live test generation."""
    result = {}

    # 1. Can we reach Ollama?
    try:
        ping = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=5)
        result["ollama_reachable"]   = True
        result["ollama_status_code"] = ping.status_code
    except requests.exceptions.ConnectionError:
        result["ollama_reachable"] = False
        result["fix"] = "Run `ollama serve` in a terminal."
        return result
    except Exception as e:
        result["ollama_reachable"] = False
        result["error"] = str(e)
        return result

    # 2. Which models are installed?
    models = get_available_models()
    result["installed_models"] = models
    result["detected_model"]   = detect_model()

    if not models:
        result["fix"] = "No models found. Run `ollama pull tinyllama` to download."
        return result

    # 3. Live test with minimal prompt
    try:
        test_resp = requests.post(
            f"{OLLAMA_BASE}/api/generate",
            json={
                "model":   result["detected_model"],
                "prompt":  "<|system|>You are helpful.</s><|user|>Reply with only the word OK.</s><|assistant|>\n",
                "stream":  False,
                "options": {"num_predict": 10, "temperature": 0},
            },
            timeout=120,
        )
        if test_resp.status_code == 200:
            data = test_resp.json()
            result["test_response"] = data.get("response", "").strip()
            result["test_error"]    = data.get("error")
            result["model_working"] = bool(result["test_response"])
        else:
            result["model_working"] = False
            result["http_error"]    = test_resp.status_code
            result["raw"]           = test_resp.text[:300]
    except requests.exceptions.Timeout:
        result["model_working"] = False
        result["fix"] = (
            f"Model `{result['detected_model']}` timed out. "
            "Run `ollama run tinyllama` in terminal to pre-load it."
        )
    except Exception as e:
        result["model_working"] = False
        result["error"] = str(e)

    return result


@app.get("/health")
def health():
    return {
        "status":       "ok",
        "docx_support": DOCX_SUPPORTED,
        "active_model": detect_model(),
    }
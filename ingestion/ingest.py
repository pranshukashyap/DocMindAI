import json
from extract_text import extract_text_from_pdf, clean_text
from chunk_text import chunk_text

PDF_PATH = "input_docs/sample.pdf"
OUTPUT_PATH = "output_chunks/chunks.json"

pages = extract_text_from_pdf(PDF_PATH)

all_chunks = []

for p in pages:
    text = p["text"]
    page_number = p["page"]

    chunks = chunk_text(text, chunk_size=500, overlap=100)

    for i, chunk in enumerate(chunks):
        chunk_data = {
            "chunk_id": f"page{page_number}_chunk{i}",
            "text": chunk,
            "source": "sample.pdf",
            "page": page_number
        }

        all_chunks.append(chunk_data)

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    json.dump(all_chunks, f, indent=2)

print(f"\n✅ {len(all_chunks)} chunks stored in {OUTPUT_PATH}")

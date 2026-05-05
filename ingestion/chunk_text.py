def chunk_text(text, chunk_size=500, overlap=100):
    """
    Splits text into overlapping chunks.

    chunk_size: number of characters per chunk
    overlap: number of characters shared between chunks
    """

    chunks = []
    start = 0
    text_length = len(text)

    while start < text_length:
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk)
        start = end - overlap

    return chunks


# TESTING BLOCK
if __name__ == "__main__":
    sample_text = (
        "Artificial Intelligence is transforming the way humans interact with "
        "information. Modern AI systems rely on large amounts of unstructured data "
        "such as documents, notes, and PDFs. Chunking helps divide this data into "
        "smaller meaningful units so that models can process it efficiently."
    )

    result = chunk_text(sample_text, chunk_size=80, overlap=20)

    for i, c in enumerate(result):
        print(f"\nChunk {i+1}:\n{c}")

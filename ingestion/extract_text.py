from pypdf import PdfReader

import re

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    text = text.replace('\n', ' ')
    text = text.strip()
    return text


def extract_text_from_pdf(pdf_path):
    reader = PdfReader(pdf_path)
    text_data = []

    for page_num, page in enumerate(reader.pages):
        raw_text = page.extract_text()
        if raw_text:
            cleaned_text = clean_text(raw_text)
            text_data.append({
                "page": page_num + 1,
                "text": cleaned_text
            })


    return text_data


if __name__ == "__main__":
    pdf_path = "input_docs/sample.pdf"
    pages = extract_text_from_pdf(pdf_path)

    for p in pages:
        print(f"Page {p['page']} has {len(p['text'])} characters")

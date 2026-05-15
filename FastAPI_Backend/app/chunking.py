from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TextChunk:
    text: str
    start: int
    end: int


def chunk_text(text: str, size: int = 3000, overlap: int = 200) -> list[TextChunk]:
    if size <= 0:
        raise ValueError("chunk size must be positive")
    if overlap < 0 or overlap >= size:
        raise ValueError("overlap must be non-negative and smaller than chunk size")
    if not text:
        return []

    chunks: list[TextChunk] = []
    start = 0
    text_length = len(text)

    while start < text_length:
        end = min(start + size, text_length)
        chunks.append(TextChunk(text=text[start:end], start=start, end=end))
        if end == text_length:
            break
        start = end - overlap

    return chunks

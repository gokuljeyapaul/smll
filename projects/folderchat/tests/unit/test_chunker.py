"""Chunker: anchors preserved, size cap, no mid-word cuts."""


def _mod():
    from folderchat import chunker
    return chunker


def test_chunks_carry_anchors():
    chunker = _mod()
    blocks = [
        {"text": "First paragraph of section one. " * 20, "page": 1, "heading": "Travel"},
        {"text": "Second block on page two. " * 20, "page": 2, "heading": None},
    ]
    chunks = chunker.chunk_blocks(blocks, max_chars=300, overlap=0)
    assert chunks, "no chunks produced"
    assert all(c.text for c in chunks)
    assert {c.page for c in chunks} <= {1, 2}
    assert chunks[0].heading == "Travel"


def test_chunk_size_cap_respected():
    chunker = _mod()
    blocks = [{"text": "word " * 2000, "page": 1, "heading": "Big"}]
    chunks = chunker.chunk_blocks(blocks, max_chars=400, overlap=0)
    assert all(len(c.text) <= 400 for c in chunks), [len(c.text) for c in chunks]
    assert len(chunks) > 1


def test_chunks_never_cut_mid_word():
    chunker = _mod()
    blocks = [{"text": "supercalifragilistic " * 100, "page": 1, "heading": None}]
    chunks = chunker.chunk_blocks(blocks, max_chars=50, overlap=0)
    for c in chunks:
        assert not c.text.startswith(" "), "chunk starts mid-space"
        assert not c.text.endswith("istic"[:3]), "chunk cut mid-word"


def test_empty_blocks_produce_no_chunks():
    chunker = _mod()
    assert chunker.chunk_blocks([], max_chars=100, overlap=0) == []
    assert chunker.chunk_blocks([{"text": "   ", "page": 1, "heading": None}], max_chars=100, overlap=0) == []

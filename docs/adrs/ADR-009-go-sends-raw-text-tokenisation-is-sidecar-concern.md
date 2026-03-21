# ADR-009: Go Sends Raw Text to Sidecar; Tokenisation Is a Sidecar Concern

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

FinBERT requires WordPiece tokenisation before inference. WordPiece is a subword segmentation algorithm tied to a specific vocabulary file and produces padding, truncation, and attention masks that must be exactly consistent with the model weights. Two placements were considered:

1. **Tokenise in Go** — the Go engine loads a vocabulary file (`.vocab.toml`), implements WordPiece segmentation, constructs input tensors, and sends a float array to the sidecar.
2. **Tokenise in the sidecar** — Go sends plain normalised text; the sidecar runs the HuggingFace `AutoTokenizer` internally before calling the ONNX session.

## Decision

The Go engine performs only Unicode NFKC normalisation and concatenates article title and body before sending the result as a plain text string to the sidecar's `/infer` endpoint. All tokenisation (WordPiece segmentation, padding, truncation, attention masks) happens inside `nlp_sidecar/model.py` using the HuggingFace `AutoTokenizer`.

## Rationale

- FinBERT's WordPiece tokeniser is a Python-native component with no clean, maintained Go port. A hand-ported implementation would be a maintenance liability and a source of subtle tokenisation drift.
- Keeping tokenisation co-located with the model guarantees that the vocabulary and segmentation logic are always consistent with the ONNX weights that consume them. A mismatch between tokeniser and model is a silent accuracy bug, not a startup error.
- This removes the need for any model-specific vocabulary artifact (`.vocab.toml`) to be loaded or understood by the Go engine. The Go feature-extraction layer becomes model-agnostic: swapping FinBERT for another transformer requires no Go changes.
- The previous LightGBM pipeline required a 4,096-term TF-IDF vocabulary file in Go. That artifact (`TFIDFVectorizer`, `.vocab.toml`, `FeatureVector.TFIDF`) has been removed and must not be re-introduced (see AGENTS.md §14).

## Consequences

- The sidecar's `/infer` request body carries a single `text` string field, not a feature vector. The Go engine never constructs token IDs or attention masks.
- The `TextPreparer` interface in Go is intentionally minimal: Unicode NFKC normalisation + HTML entity decoding + title/body concatenation. No vocabulary lookup, no stemming, no stopword removal.
- The HuggingFace tokenizer directory (`tokenizer/`) is loaded once at sidecar startup and is **not** reloaded during a model hot-swap. The tokenizer vocabulary is stable across FinBERT fine-tuned versions (see AGENTS.md §14 and `nlp_sidecar/model.py`).
- Any future model that requires a different tokenizer must be treated as a new sidecar deployment, not a hot-swap of the ONNX file alone.

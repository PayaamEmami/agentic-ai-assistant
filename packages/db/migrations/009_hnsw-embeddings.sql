-- IVFFlat was created on an empty embeddings table (lists = 100), so its
-- lists were never trained on a personal corpus. HNSW does not need that pass.

DROP INDEX IF EXISTS idx_embeddings_vector;

CREATE INDEX idx_embeddings_vector
  ON embeddings
  USING hnsw (vector vector_cosine_ops);

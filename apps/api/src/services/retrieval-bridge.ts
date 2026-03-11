export class RetrievalBridge {
  async search(_query: string, _userId: string) {
    // TODO: connect to @aaa/retrieval package
    // 1. Run vector search
    // 2. Rerank results
    // 3. Assemble citations
    return { results: [], citations: [] };
  }
}

export function chunkText(text, options = {}) {
  const chunkSize = Number.parseInt(String(options.chunkSize || process.env.CHUNK_SIZE || 1000), 10);
  const sentenceOverlap = Number.parseInt(String(options.sentenceOverlap || 1), 10); // default to 1 sentence overlap
  
  if (!text || typeof text !== "string") {
    return [];
  }
  
  // 1. Split into sentences.
  // Match sequences of non-punctuation chars followed by punctuation/newline, OR end of string.
  const rawSentences = text.match(/[^.!?\n]+[.!?\n]+(?:\s|$)|[^.!?\n]+$/g) || [text];
  const sentences = rawSentences.map(s => s.trim()).filter(s => s.length > 0);

  const chunks = [];
  let currentChunkSentences = [];
  let currentChunkLength = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceLen = sentence.length;

    // Never cut a sentence in the middle unless it exceeds the max size alone
    if (sentenceLen > chunkSize) {
      if (currentChunkSentences.length > 0) {
        chunks.push(currentChunkSentences.join(" "));
        currentChunkSentences = [];
        currentChunkLength = 0;
      }
      
      // Hard split the oversized sentence
      let start = 0;
      while (start < sentenceLen) {
        chunks.push(sentence.slice(start, start + chunkSize));
        start += chunkSize;
      }
      continue;
    }

    if (currentChunkLength + sentenceLen + (currentChunkSentences.length > 0 ? 1 : 0) > chunkSize) {
      // Pushing this sentence exceeds the chunk size. Save the current chunk.
      chunks.push(currentChunkSentences.join(" "));
      
      // Start a new chunk, carrying over the configured number of overlap sentences
      const overlap = currentChunkSentences.slice(-Math.max(1, sentenceOverlap));
      currentChunkSentences = [...overlap, sentence];
      currentChunkLength = currentChunkSentences.reduce((acc, s) => acc + s.length, 0) + (currentChunkSentences.length > 1 ? currentChunkSentences.length - 1 : 0);
    } else {
      // Add sentence to current chunk
      currentChunkSentences.push(sentence);
      currentChunkLength += sentenceLen + (currentChunkSentences.length > 1 ? 1 : 0);
    }
  }

  if (currentChunkSentences.length > 0) {
    chunks.push(currentChunkSentences.join(" "));
  }

  return chunks;
}

export function chunkDocument(document, options = {}) {
  const textChunks = chunkText(document.text, options);
  
  return textChunks.map((text, index) => ({
    chunkIndex: index,
    text: text,
    orgId: document.orgId,
    documentId: document.documentId,
    employeeId: document.employeeId,
    tokenCount: Math.ceil(text.length / 4), // rough approximation
    sensitivity: document.sensitivity || 'standard'
  }));
}

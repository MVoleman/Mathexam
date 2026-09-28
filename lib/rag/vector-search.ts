import { and, asc, cosineDistance, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/db";
import { solutionReferences, type SolutionReference } from "@/db/schema";

export type SolutionReferenceMatch = SolutionReference & {
  /** Cosine similarity in [0, 1] (1 = identical direction). */
  similarity: number;
};

/**
 * Hybrid RAG search over the solution-reference knowledge base.
 *
 * Strategy:
 *  1. Exact-match metadata filtering on `course` and `topic` (uses the
 *     course/topic b-tree index) to shrink the candidate set.
 *  2. Vector similarity ordering with pgvector's cosine distance (`<=>`)
 *     against the query embedding (uses the HNSW index).
 */
export async function findRelevantSolutionReferences(
  queryEmbedding: number[],
  courseFilter: string,
  topicFilter: string,
  limit: number = 3,
): Promise<SolutionReferenceMatch[]> {
  if (queryEmbedding.length !== 768) {
    throw new Error(
      `Query embedding must have 768 dimensions, received ${queryEmbedding.length}.`,
    );
  }

  const distance = cosineDistance(solutionReferences.embedding, queryEmbedding);

  const rows = await db
    .select({
      ...getTableColumns(solutionReferences),
      similarity: sql<number>`1 - (${distance})`,
    })
    .from(solutionReferences)
    .where(
      and(
        eq(solutionReferences.course, courseFilter),
        eq(solutionReferences.topic, topicFilter),
      ),
    )
    .orderBy(asc(distance))
    .limit(limit);

  return rows;
}

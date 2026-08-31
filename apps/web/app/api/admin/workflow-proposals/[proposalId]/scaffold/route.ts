import { headers } from "next/headers";
import { createDatabase, getWorkflowProposalById } from "@chronica/db";
import { resolveAccount } from "../../../../../../lib/account-service";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

// GET /api/admin/workflow-proposals/[proposalId]/scaffold
// Returns a TypeScript workflow definition stub based on the proposal.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  const { proposalId } = await params;
  const account = await resolveAccount(await headers());
  if (!account) return Response.json({ error: "Unauthorized." }, { status: 401 });
  if (account.role !== "developer" && account.role !== "admin") {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const proposal = await getWorkflowProposalById(db, proposalId);
    if (!proposal) return Response.json({ error: "Not found." }, { status: 404 });

    const id = proposal.intent
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40);

    const stub = `import { z } from "zod";
import { defineWorkflow } from "../types";

// Generated from Workflow Manager novel action proposal ${proposal.id}
// Source: ${proposal.source} / ${proposal.sourceRef}
// Intent: ${proposal.intent}
// Estimated mutation: ${proposal.estimatedMutationDescription}
// Target entities: ${proposal.targetEntityIds.join(", ") || "none specified"}
//
// TODO: Implement the apply() function to mutate WorldState as intended.

export const ${id}Workflow = defineWorkflow({
  id: "${id}",
  description: "${proposal.intent.replace(/"/g, '\\"').slice(0, 120)}",
  category: "narrative", // TODO: change to the appropriate category
  // invokerAuthority: ["world_director"], // TODO: set authority
  // scopeLimit: "near",                  // TODO: set scope if world_director
  parametersSchema: z.object({
    // TODO: define required parameters
    actorId: z.string(),
    targetId: z.string().optional(),
    reason: z.string().min(1).max(240),
  }).strict(),
  apply(world, params, context) {
    // TODO: implement world mutation
    // Must return { world: newWorldState, result: { summary: string, applied: boolean } }
    // or null if the action cannot be applied.
    return null;
  },
});
`;

    return new Response(stub, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${id}_workflow.ts"`,
        "Cache-Control": "private, no-store",
      },
    });
  } finally {
    await close();
  }
}

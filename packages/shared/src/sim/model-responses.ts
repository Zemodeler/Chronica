import { z } from "zod";

// Shared by the simulation readers and provider grammars, so the model writes
// the object the reader expects rather than JSON escaped inside a string.
export const CHRONICLE_MAX_ENTRIES = 10;
export const ChronicleOutputSchema = z.object({
  entries: z.array(z.object({
    thread: z.number().int().positive(),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1),
    quote: z.object({
      speaker: z.string().trim().min(1).max(120),
      line: z.string().trim().min(1).max(220),
      occasion: z.string().trim().min(1).max(160),
    }).nullable().optional().catch(null),
  })).max(CHRONICLE_MAX_ENTRIES),
}).strict();

export const ReconcileOutputSchema = z.object({
  withdraw: z.array(z.string()).max(32).default([]),
  rewrite: z.array(z.object({localId: z.string(), summary: z.string().trim().min(1).max(600)}).strict()).max(32).default([]),
}).strict();

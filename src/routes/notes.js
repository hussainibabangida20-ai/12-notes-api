import { Router } from "express";
import { z } from "zod";
import { sql } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../lib/validate.js";

const router = Router();

const idSchema = z.object({
  id: z.string().uuid(),
});

const listQuerySchema = z.object({
  q: z.string().trim().max(200).transform((value) => value || undefined).optional(),
  tag: z.string().trim().min(1).max(100).optional(),
  pinned: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().default(""),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  pinned: z.boolean().default(false),
}).strict();

const updateNoteSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  pinned: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided",
});

function buildFilters(userId, { q, tag, pinned }) {
  const conditions = [sql`user_id = ${userId}`];

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(sql`(title ILIKE ${pattern} OR body ILIKE ${pattern})`);
  }
  if (tag !== undefined) {
    conditions.push(sql`${tag} = ANY(tags)`);
  }
  if (pinned !== undefined) {
    conditions.push(sql`pinned = ${pinned}`);
  }

  return conditions.slice(1).reduce(
    (combined, condition) => sql`${combined} AND ${condition}`,
    conditions[0],
  );
}

router.use(requireAuth);

router.get("/", validate(listQuerySchema, "query"), async (req, res) => {
  const filters = req.validated.query;
  const where = buildFilters(req.user.id, filters);
  const offset = (filters.page - 1) * filters.limit;
  const [notes, countRows] = await Promise.all([
    sql`
      SELECT id, user_id, title, body, tags, pinned, created_at, updated_at
      FROM notes
      WHERE TRUE AND ${where}
      ORDER BY pinned DESC, updated_at DESC
      LIMIT ${filters.limit} OFFSET ${offset}
    `,
    sql`
      SELECT COUNT(*)::int AS total
      FROM notes
      WHERE TRUE AND ${where}
    `,
  ]);
  const total = countRows[0].total;

  return res.json({
    notes,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit),
    },
  });
});

router.get("/:id", validate(idSchema, "params"), async (req, res) => {
  const { id } = req.validated.params;
  const [note] = await sql`
    SELECT id, user_id, title, body, tags, pinned, created_at, updated_at
    FROM notes
    WHERE id = ${id} AND user_id = ${req.user.id}
    LIMIT 1
  `;

  if (!note) {
    return res.status(404).json({ error: { message: "Note not found" } });
  }
  return res.json({ note });
});

router.post("/", validate(createNoteSchema), async (req, res) => {
  const { title, body, tags, pinned } = req.body;
  const [note] = await sql`
    INSERT INTO notes (user_id, title, body, tags, pinned)
    VALUES (${req.user.id}, ${title}, ${body}, ${tags}, ${pinned})
    RETURNING id, user_id, title, body, tags, pinned, created_at, updated_at
  `;

  return res.status(201).json({ note });
});

router.patch("/:id", validate(idSchema, "params"), validate(updateNoteSchema), async (req, res) => {
  const { id } = req.validated.params;
  const { title, body, tags, pinned } = req.body;
  const [note] = await sql`
    UPDATE notes
    SET title = CASE WHEN ${title !== undefined} THEN ${title ?? null}::text ELSE title END,
        body = CASE WHEN ${body !== undefined} THEN ${body ?? null}::text ELSE body END,
        tags = CASE WHEN ${tags !== undefined} THEN ${tags ?? null}::text[] ELSE tags END,
        pinned = CASE WHEN ${pinned !== undefined} THEN ${pinned ?? null}::boolean ELSE pinned END,
        updated_at = now()
    WHERE id = ${id} AND user_id = ${req.user.id}
    RETURNING id, user_id, title, body, tags, pinned, created_at, updated_at
  `;

  if (!note) {
    return res.status(404).json({ error: { message: "Note not found" } });
  }
  return res.json({ note });
});

router.delete("/:id", validate(idSchema, "params"), async (req, res) => {
  const { id } = req.validated.params;
  const [note] = await sql`
    DELETE FROM notes
    WHERE id = ${id} AND user_id = ${req.user.id}
    RETURNING id
  `;

  if (!note) {
    return res.status(404).json({ error: { message: "Note not found" } });
  }
  return res.status(204).end();
});

export default router;

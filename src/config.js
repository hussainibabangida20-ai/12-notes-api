import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url().refine(
    (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
    "must be a PostgreSQL connection URL",
  ),
  JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const issues = result.error.issues
    .map(({ path, message }) => `${path.join(".")}: ${message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const config = Object.freeze(result.data);

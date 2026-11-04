import cors from "cors";
import express from "express";
import helmet from "helmet";
import authRouter from "./routes/auth.js";
import healthRouter from "./routes/health.js";
import notesRouter from "./routes/notes.js";

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:3000",
]);

export const app = express();

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin));
  },
}));
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});
app.use(express.json({ limit: "100kb" }));

app.use("/api/auth", authRouter);
app.use("/api/health", healthRouter);
app.use("/api/notes", notesRouter);

app.use((_req, res) => {
  res.status(404).json({
    error: { message: "Not Found" },
  });
});

app.use((err, _req, res, _next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500
    ? err.status
    : 500;
  const message = status === 500 ? "Internal Server Error" : err.message;

  if (status === 500) {
    console.error(err);
  }

  res.status(status).json({
    error: { message },
  });
});

export default app;

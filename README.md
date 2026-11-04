# Notes API

A Node.js 20+ REST API built with Express 5 (ES modules) and Neon Postgres.

## Setup

1. Install Node.js 20 or newer.
2. Create a Neon project and database. Copy its pooled connection string from the Neon dashboard.
3. Apply [`schema.sql`](./schema.sql) to the database.
4. Create a `.env` file in the project root:

   ```dotenv
   DATABASE_URL=postgresql://<user>:<password>@<host>-pooler.<region>.aws.neon.tech/<database>?sslmode=require
   JWT_SECRET=<at-least-32-random-characters>
   PORT=4000
   ```

   Generate a suitable JWT secret with:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

5. Start the development server:

   ```sh
   npm install
   npm run dev
   ```

The server listens on port `4000` by default. `.env` and `.env.test` are ignored by Git.

## API endpoints

All responses use JSON except successful note deletion, which returns `204 No Content`. Protected endpoints require `Authorization: Bearer <token>`.

| Method | Path | Auth | Description |
|---|---|---:|---|
| `GET` | `/api/health` | No | Checks the database connection |
| `POST` | `/api/auth/register` | No | Creates an account and returns `{ user, token }` |
| `POST` | `/api/auth/login` | No | Verifies credentials and returns `{ token, user }` |
| `GET` | `/api/auth/me` | Yes | Returns the authenticated user |
| `GET` | `/api/notes?q=&tag=&pinned=&page=&limit=` | Yes | Lists the current user's notes with filters and pagination metadata |
| `GET` | `/api/notes/:id` | Yes | Gets one of the current user's notes |
| `POST` | `/api/notes` | Yes | Creates a note for the current user |
| `PATCH` | `/api/notes/:id` | Yes | Updates one of the current user's notes |
| `DELETE` | `/api/notes/:id` | Yes | Deletes one of the current user's notes |

Validation errors return `422`, missing or invalid authentication returns `401`, and attempts to access a missing or another user's note return `404`.

## Authentication flow

```mermaid
sequenceDiagram
    actor Client
    participant API
    participant DB as Neon Postgres

    Client->>API: POST /api/auth/register (name, email, password)
    API->>API: Validate input; lowercase email; bcrypt hash (cost 12)
    API->>DB: Insert user and password_hash
    DB-->>API: Public user fields
    API->>API: Sign HS256 JWT (sub = user ID, expires in 1h)
    API-->>Client: 201 { user, token }
    Client->>API: Request with Authorization: Bearer token
    API->>API: Verify signature, algorithm, and expiration
    API->>DB: Query scoped to authenticated user ID
    DB-->>API: Authorized result
    API-->>Client: JSON response
```

## Testing

The integration tests use a **separate Neon branch**. Neon branching creates an isolated branch from a parent branch using copy-on-write storage, so test writes do not modify the parent. Create a dedicated test branch in the Neon dashboard (preferably from a development branch without production data), copy its pooled connection string, and set it as `TEST_DATABASE_URL`. Apply `schema.sql` to that branch before running tests.

The test harness will not fall back to `DATABASE_URL`; it refuses to start without `TEST_DATABASE_URL`.

PowerShell:

```powershell
$env:TEST_DATABASE_URL = "postgresql://<user>:<password>@<test-branch>-pooler.<region>.aws.neon.tech/<database>?sslmode=require"
npm test
```

On macOS/Linux:

```sh
TEST_DATABASE_URL='postgresql://<user>:<password>@<test-branch>-pooler.<region>.aws.neon.tech/<database>?sslmode=require' npm test
```

Tests create uniquely named accounts and delete them afterward. A temporary JWT secret is generated for tests unless `JWT_SECRET` is already set.

## REST Client

Open [`requests.http`](./requests.http) in VS Code with the REST Client extension. Run register, then login; the `login` request captures its token for `/me` and the notes requests. The file also includes validation, missing/expired/garbled token, and cross-user ownership failure examples.

To exercise the expired-token request, replace `@expiredToken` in `requests.http` with a locally generated expired token:

```sh
node --env-file=.env --input-type=module -e "import jwt from 'jsonwebtoken'; console.log(jwt.sign({sub:'demo'}, process.env.JWT_SECRET, {algorithm:'HS256', expiresIn:-1}))"
```

## Security protections

- Passwords are stored as bcrypt hashes with cost 12; hashes are never returned.
- JWTs are signed with HS256, restricted to HS256 during verification, and expire after one hour.
- Protected routes verify bearer tokens; auth endpoints are rate-limited to 10 requests per 15 minutes per IP.
- Zod validates request bodies, query parameters, and note IDs before database operations.
- Every note lookup or mutation is scoped to the authenticated user. Cross-user note access returns `404`, not `403`, to avoid revealing whether the note exists.
- Database calls use parameterized Neon tagged-template SQL; dynamic list filters compose parameterized fragments rather than user-built SQL strings.
- Helmet security headers, an explicit localhost CORS allowlist, and a 100 KB JSON body limit are enabled.
- Unexpected server errors return a generic message rather than exposing stack traces or SQL details.

JWT payloads are **signed, not encrypted**: anyone holding a token can decode its header and payload. Do not put passwords, password hashes, secrets, or other sensitive data in a token payload.

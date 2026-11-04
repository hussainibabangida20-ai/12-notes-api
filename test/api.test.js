import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, test } from "node:test";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required. Set it to a dedicated Neon test-branch connection string before running npm test.",
  );
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= randomBytes(32).toString("base64url");

const [{ default: request }, { app }, { sql }] = await Promise.all([
  import("supertest"),
  import("../src/app.js"),
  import("../src/db.js"),
]);

const testEmails = [];

function createAccountDetails(label) {
  const email = `notes-api-${label}-${randomUUID()}@example.com`;
  testEmails.push(email);
  return {
    name: `Test ${label}`,
    email,
    password: "TestPassword123",
  };
}

async function registerAccount(account) {
  const response = await request(app)
    .post("/api/auth/register")
    .send(account)
    .expect(201);
  return response.body;
}

after(async () => {
  for (const email of testEmails) {
    await sql`DELETE FROM users WHERE email = ${email}`;
  }
});

test("registers, logs in, and returns the current user without a password hash", async () => {
  const account = createAccountDetails("auth");
  const registration = await registerAccount({
    ...account,
    email: account.email.toUpperCase(),
  });

  assert.equal(registration.user.email, account.email);
  assert.equal(typeof registration.token, "string");
  assert.equal("password_hash" in registration.user, false);

  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: account.email, password: account.password })
    .expect(200);

  assert.equal(login.body.user.id, registration.user.id);
  assert.equal(typeof login.body.token, "string");
  assert.equal("password_hash" in login.body.user, false);

  const currentUser = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${login.body.token}`)
    .expect(200);

  assert.equal(currentUser.body.user.id, registration.user.id);
  assert.equal(currentUser.body.user.email, account.email);
  assert.equal("password_hash" in currentUser.body.user, false);
});

test("requires authentication for notes endpoints", async () => {
  const response = await request(app)
    .get("/api/notes")
    .expect("WWW-Authenticate", /^Bearer/)
    .expect(401);

  assert.equal(response.body.error.message, "Authentication required");
});

test("a user cannot read, update, or delete another user's note", async () => {
  const owner = await registerAccount(createAccountDetails("owner"));
  const other = await registerAccount(createAccountDetails("other"));
  const note = await request(app)
    .post("/api/notes")
    .set("Authorization", `Bearer ${owner.token}`)
    .send({ title: "Owner-only note", body: "Private" })
    .expect(201);
  const noteId = note.body.note.id;
  const otherAuth = `Bearer ${other.token}`;

  await request(app)
    .get(`/api/notes/${noteId}`)
    .set("Authorization", otherAuth)
    .expect(404);

  await request(app)
    .patch(`/api/notes/${noteId}`)
    .set("Authorization", otherAuth)
    .send({ title: "Unauthorized update" })
    .expect(404);

  await request(app)
    .delete(`/api/notes/${noteId}`)
    .set("Authorization", otherAuth)
    .expect(404);

  const stillOwned = await request(app)
    .get(`/api/notes/${noteId}`)
    .set("Authorization", `Bearer ${owner.token}`)
    .expect(200);
  assert.equal(stillOwned.body.note.title, "Owner-only note");
});

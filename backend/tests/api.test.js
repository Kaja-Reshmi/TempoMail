import test from "node:test";
import assert from "node:assert/strict";

const API = process.env.API_URL || "http://localhost:5001";

async function request(path, options = {}) {
  return fetch(`${API}${path}`, options);
}

test("TempoMail API integration checks", async (t) => {
  await t.test("API welcome endpoint responds", async () => {
    const response = await request("/");
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.message, "Welcome to TempoMail API");
  });

  await t.test("Health endpoint confirms all services", async () => {
    const response = await request("/api/health");
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.services.api, "running");
    assert.equal(data.services.database, "connected");
    assert.equal(data.services.redis, "connected");
    assert.equal(data.services.worker, "online");
  });

  await t.test("Registration rejects invalid input", async () => {
    const response = await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "X",
        email: "not-an-email",
        password: "123"
      })
    });

    assert.equal(response.status, 400);
  });

  await t.test("Login rejects invalid input", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "invalid",
        password: ""
      })
    });

    assert.equal(response.status, 400);
  });

  await t.test("Current-user endpoint requires authentication", async () => {
    const response = await request("/api/auth/me");
    assert.equal(response.status, 401);
  });

  await t.test("Email listing requires authentication", async () => {
    const response = await request("/api/emails");
    assert.equal(response.status, 401);
  });

  await t.test("Email statistics require authentication", async () => {
    const response = await request("/api/emails/stats");
    assert.equal(response.status, 401);
  });

  await t.test("Unknown API routes return 404", async () => {
    const response = await request("/api/does-not-exist");
    const data = await response.json();

    assert.equal(response.status, 404);
    assert.equal(data.success, false);
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../server');

async function getResponse(path) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
    return {
      status: response.status,
      location: response.headers.get('location')
    };
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test('GET /auth/github redirects to GitHub PAT creation flow when OAuth is not configured', async () => {
  const result = await getResponse('/auth/github');

  assert.equal(result.status, 302);
  assert.match(result.location, /^https:\/\/github\.com\/settings\/tokens\/new/);
  assert.match(result.location, /scopes=read%3Auser%2Crepo%2Csecurity_events/);
});

test('GET /api/github returns no repo data when no token is configured', async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/github`);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.connected, false);
    assert.ok(Array.isArray(data.repos) || data.repos === undefined);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GET /repos and /repo-details render the dedicated repos pages', async () => {
  const reposResult = await getResponse('/repos');
  const detailResult = await getResponse('/repo-details?source=github&name=sample-repo');

  assert.equal(reposResult.status, 200);
  assert.equal(detailResult.status, 200);
});

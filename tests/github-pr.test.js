const test = require('node:test');
const assert = require('node:assert/strict');
const { app, setGitHubTokenForTests } = require('../server');

const originalFetch = global.fetch;

function mockGithubOverviewFetch() {
  global.fetch = async (url, options) => {
    if (typeof url === 'string' && url.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }

    if (url === 'https://api.github.com/user') {
      return {
        ok: true,
        json: async () => ({ login: 'alice', name: 'Alice', public_repos: 3 })
      };
    }

    if (url === 'https://api.github.com/user/repos?per_page=10&sort=updated') {
      return {
        ok: true,
        json: async () => [{
          name: 'project',
          owner: { login: 'alice' },
          private: false,
          language: 'JavaScript',
          updated_at: '2026-09-10T00:00:00Z',
          html_url: 'https://github.com/alice/project'
        }]
      };
    }

    if (url === 'https://api.github.com/repos/alice/project/dependabot/alerts?state=open') {
      return {
        ok: true,
        json: async () => [
          { rule: { severity: 'high' } },
          { rule: { severity: 'critical' } }
        ]
      };
    }

    if (url === 'https://api.github.com/repos/alice/project/code-scanning/alerts?state=open') {
      return {
        ok: true,
        json: async () => []
      };
    }

    if (url === 'https://api.github.com/user/repos?per_page=25&sort=updated') {
      return {
        ok: true,
        json: async () => [{ name: 'project', owner: { login: 'alice' } }]
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };
}

function mockGithubFetch() {
  global.fetch = async (url, options) => {
    if (typeof url === 'string' && url.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }

    if (url === 'https://api.github.com/user') {
      return {
        ok: true,
        json: async () => ({ login: 'alice' })
      };
    }

    if (url === 'https://api.github.com/user/repos?per_page=25&sort=updated' || url === 'https://api.github.com/user/repos?per_page=20&sort=updated') {
      return {
        ok: true,
        json: async () => [{ name: 'project', owner: { login: 'alice' } }]
      };
    }

    if (url === 'https://api.github.com/repos/alice/project/pulls?state=open&per_page=5') {
      return {
        ok: true,
        json: async () => [
          {
            title: 'Fix API timeout',
            state: 'open',
            number: 12,
            created_at: '2026-09-10T00:00:00Z',
            updated_at: '2026-09-12T00:00:00Z',
            html_url: 'https://github.com/alice/project/pull/12',
            comments: 3,
            user: { login: 'alice' },
            base: { ref: 'main' },
            head: { ref: 'feature/fix-timeout' }
          }
        ]
      };
    }

    if (url === 'https://api.github.com/repos/alice/project/pulls/12') {
      return {
        ok: true,
        json: async () => ({
          title: 'Fix API timeout',
          number: 12,
          state: 'open',
          user: { login: 'alice' },
          created_at: '2026-09-10T00:00:00Z',
          updated_at: '2026-09-12T00:00:00Z',
          base: { ref: 'main' },
          head: { ref: 'feature/fix-timeout' }
        })
      };
    }

    if (url === 'https://api.github.com/repos/alice/project/pulls/12/files?per_page=100') {
      return {
        ok: true,
        json: async () => [
          {
            filename: 'src/api.js',
            status: 'modified',
            additions: 5,
            deletions: 2,
            changes: 7,
            patch: '@@\n- const timeout = 5000;\n+ const timeout = 3000;'
          }
        ]
      };
    }

    if (url === 'https://api.github.com/repos/alice/project/actions/runs?per_page=5') {
      return {
        ok: true,
        json: async () => ({
          workflow_runs: [
            {
              name: 'CI',
              status: 'completed',
              conclusion: 'success',
              created_at: '2026-09-14T00:00:00Z',
              updated_at: '2026-09-14T01:00:00Z',
              html_url: 'https://github.com/alice/project/actions/runs/1',
              run_number: 12,
              event: 'push',
              head_branch: 'main',
              actor: { login: 'alice' }
            }
          ]
        })
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };
}

test('GET /api/github/pulls returns an empty queue when no GitHub token is configured', async () => {
  mockGithubFetch();
  setGitHubTokenForTests(null);

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/github/pulls`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, []);
  } finally {
    server.close();
    global.fetch = originalFetch;
    setGitHubTokenForTests(null);
  }
});

test('GET /api/overview calculates overall risk from GitHub security alerts', async () => {
  mockGithubOverviewFetch();
  setGitHubTokenForTests('mock-token');

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/overview`, {
      headers: { 'x-github-token': 'mock-token' }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.ok(payload.overallRisk.score > 0, 'overall risk should rise when GitHub alerts are present');
    assert.match(payload.overallRisk.label, /critical|high|moderate|low/i);
  } finally {
    server.close();
    global.fetch = originalFetch;
    setGitHubTokenForTests(null);
  }
});

test('POST /api/notifications/email sends a notification when SMTP is configured', async () => {
  const nodemailer = require('nodemailer');
  const originalCreateTransport = nodemailer.createTransport;
  const calls = [];

  nodemailer.createTransport = () => ({
    sendMail: async (options) => {
      calls.push(options);
      return { messageId: 'test-123' };
    }
  });

  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'ops@example.com';
  process.env.SMTP_PASS = 'secret';
  process.env.SMTP_FROM = 'alerts@example.com';

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/notifications/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'admin@example.com',
        subject: 'Approval complete',
        text: 'Approved successfully.'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to, 'admin@example.com');
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    server.close();
  }
});

test('GET /api/github/pulls returns pull request details payload', async () => {
  mockGithubFetch();
  setGitHubTokenForTests(null);

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/github/pulls`, {
      headers: { 'x-github-token': 'mock-token' }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(Array.isArray(payload), true);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].repository, 'project');
    assert.equal(payload[0].user, 'alice');
  } finally {
    server.close();
    global.fetch = originalFetch;
    setGitHubTokenForTests(null);
  }
});

test('GET /api/github/actions returns workflow run details payload', async () => {
  mockGithubFetch();
  setGitHubTokenForTests(null);

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/github/actions`, {
      headers: { 'x-github-token': 'mock-token' }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(Array.isArray(payload), true);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].repository, 'project');
    assert.equal(payload[0].name, 'CI');
  } finally {
    server.close();
    global.fetch = originalFetch;
    setGitHubTokenForTests(null);
  }
});

test('GET /api/github/pulls/alice/project/12/review returns file diffs for review', async () => {
  mockGithubFetch();
  setGitHubTokenForTests(null);

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/github/pulls/alice/project/12/review`, {
      headers: { 'x-github-token': 'mock-token' }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.review.title, 'Fix API timeout');
    assert.equal(Array.isArray(payload.review.files), true);
    assert.equal(payload.review.files[0].filename, 'src/api.js');
  } finally {
    server.close();
    global.fetch = originalFetch;
    setGitHubTokenForTests(null);
  }
});

test('POST /api/github/pulls/alice/project/12/review returns a helpful message when the GitHub token cannot approve the PR', async () => {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    if (url === 'https://api.github.com/repos/alice/project/pulls/12/reviews') {
      return {
        ok: false,
        status: 403,
        json: async () => ({
          message: 'Resource not accessible by personal access token'
        })
      };
    }

    return original(url, options);
  };

  setGitHubTokenForTests(null);

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/github/pulls/alice/project/12/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-github-token': 'mock-token' }
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.message, /repo access/i);
    assert.match(payload.message, /write access/i);
  } finally {
    server.close();
    global.fetch = originalFetch;
    setGitHubTokenForTests(null);
  }
});

test('POST /api/github/pulls/alice/project/12/review explains GitHub validation failures when the review is rejected', async () => {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    if (url === 'https://api.github.com/repos/alice/project/pulls/12/reviews') {
      return {
        ok: false,
        status: 422,
        json: async () => ({
          message: 'Validation Failed',
          errors: [{ message: 'A review already exists for this pull request from this user.' }]
        })
      };
    }

    return original(url, options);
  };

  setGitHubTokenForTests(null);

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/github/pulls/alice/project/12/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-github-token': 'mock-token' }
    });
    const payload = await response.json();

    assert.equal(response.status, 422);
    assert.match(payload.message, /already approved|already has a review|review exists|validation failed/i);
  } finally {
    server.close();
    global.fetch = originalFetch;
    setGitHubTokenForTests(null);
  }
});

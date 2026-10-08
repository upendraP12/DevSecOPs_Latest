require('dotenv').config();

const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const { getAzureResourceStatus } = require('./azure');

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_OAUTH_REDIRECT_URL = process.env.GITHUB_OAUTH_REDIRECT_URL || 'http://localhost:3000/auth/github/callback';

const githubTokenCache = { token: null };

async function fetchGitHubJson(url, token, extraHeaders = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ai-devsecops-copilot',
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function getGitHubRepoSecurityData(token, repos) {
  if (!Array.isArray(repos) || repos.length === 0) {
    return [];
  }

  const repoLimit = 5;

  const securityData = await Promise.all(
    repos.slice(0, repoLimit).map(async (repo) => {
      const repoName = repo.name;
      const owner = repo.owner?.login || repo.owner;

      if (!owner || !repoName) {
        return { name: repoName || 'unknown', alerts: 0, status: 'not-available' };
      }

      const result = {
        name: repoName,
        private: repo.private,
        language: repo.language || 'Unknown',
        updatedAt: repo.updated_at,
        alerts: 0,
        status: 'healthy'
      };

      try {
        const [dependabotAlerts, codeScanningAlerts] = await Promise.all([
          fetchGitHubJson(`https://api.github.com/repos/${owner}/${repoName}/dependabot/alerts?state=open`, token, {
            'X-GitHub-Api-Version': '2022-11-28'
          }).catch(() => []),
          fetchGitHubJson(`https://api.github.com/repos/${owner}/${repoName}/code-scanning/alerts?state=open`, token, {
            'X-GitHub-Api-Version': '2022-11-28'
          }).catch(() => [])
        ]);

        const alerts = [].concat(dependabotAlerts || []).concat(codeScanningAlerts || []);
        result.alerts = alerts.length;
        result.status = alerts.length > 0 ? 'attention-needed' : 'healthy';
        result.alertBreakdown = {
          critical: alerts.filter((alert) => (alert.rule?.severity || '').toLowerCase() === 'critical').length,
          high: alerts.filter((alert) => (alert.rule?.severity || '').toLowerCase() === 'high').length,
          medium: alerts.filter((alert) => (alert.rule?.severity || '').toLowerCase() === 'medium').length
        };
      } catch (error) {
        result.status = 'permission-limited';
      }

      return result;
    })
  );

  return securityData;
}

async function getGitHubAccountData() {
  const activeToken = githubTokenCache.token || GITHUB_TOKEN;

  if (!activeToken) {
    return {
      connected: false,
      message: 'GitHub integration is not configured. Add GITHUB_TOKEN in your .env file or click “Continue with GitHub”.'
    };
  }

  try {
    const user = await fetchGitHubJson('https://api.github.com/user', activeToken);
    const repos = await fetchGitHubJson('https://api.github.com/user/repos?per_page=10&sort=updated', activeToken);
    const repoSecurity = await getGitHubRepoSecurityData(activeToken, repos);

    return {
      connected: true,
      username: user.login,
      name: user.name || user.login,
      followers: user.followers,
      following: user.following,
      publicRepos: user.public_repos,
      repos: Array.isArray(repos)
        ? repos.slice(0, 5).map((repo) => {
            const security = repoSecurity.find((item) => item.name === repo.name) || {};
            return {
              name: repo.name,
              private: repo.private,
              language: repo.language || 'Unknown',
              updatedAt: repo.updated_at,
              htmlUrl: repo.html_url || `https://github.com/${user.login}/${repo.name}`,
              securityStatus: security.status || 'not-available',
              alerts: security.alerts || 0
            };
          })
        : [],
      repoSecurity,
      securitySummary: {
        totalAlerts: repoSecurity.reduce((sum, repo) => sum + (repo.alerts || 0), 0),
        reposWithAlerts: repoSecurity.filter((repo) => repo.alerts > 0).length,
        critical: repoSecurity.reduce((total, repo) => total + (repo.alertBreakdown?.critical || 0), 0),
        high: repoSecurity.reduce((total, repo) => total + (repo.alertBreakdown?.high || 0), 0),
        medium: repoSecurity.reduce((total, repo) => total + (repo.alertBreakdown?.medium || 0), 0)
      }
    };
  } catch (error) {
    return {
      connected: false,
      message: 'Unable to reach GitHub API. Check your token permissions or GitHub connectivity.'
    };
  }
}

function setGitHubTokenForTests(token) {
  githubTokenCache.token = token ? String(token).trim() : null;
}

function describeGitHubPermissionIssue(message, details = null) {
  const rawMessage = String(message || '');
  const normalized = rawMessage.toLowerCase();
  const detailText = Array.isArray(details?.errors)
    ? details.errors
        .map((item) => (typeof item === 'string' ? item : item?.message || ''))
        .filter(Boolean)
        .join(' ')
    : '';

  if (normalized.includes('resource not accessible by personal access token') || normalized.includes('resource not accessible by integration')) {
    return 'This GitHub token does not have permission to approve or merge this pull request. Use a PAT with repo access and make sure the token owner has write access to the repository.';
  }

  if (normalized.includes('already approved') || normalized.includes('a review already exists') || normalized.includes('review already exists')) {
    return 'This pull request already has a review from the current GitHub user. Review the existing approval or switch to a different account before approving again.';
  }

  if (normalized.includes('unprocessable entity') || normalized.includes('validation failed')) {
    const extraDetails = detailText ? ` GitHub details: ${detailText}.` : '';
    return `GitHub rejected this approval because the pull request cannot be approved with the current token.${extraDetails} Check whether the PR is already approved, the token has repo write access, and the reviewer can legally approve this branch.`;
  }

  return rawMessage || 'Unable to approve or merge this pull request.';
}

function calculateOverallRisk(github, azure) {
  const githubConnected = Boolean(github && github.connected);
  const azureConnected = Boolean(azure && azure.connected);

  if (!githubConnected && !azureConnected) {
    return {
      score: 0,
      label: 'No Data Found',
      trend: 'No Data Found'
    };
  }

  const githubAlerts = githubConnected ? (github.securitySummary?.totalAlerts || 0) : 0;
  const critical = githubConnected ? (github.securitySummary?.critical || 0) : 0;
  const high = githubConnected ? (github.securitySummary?.high || 0) : 0;
  const medium = githubConnected ? (github.securitySummary?.medium || 0) : 0;
  const azureAlerts = azureConnected ? (azure.highRiskFindings || 0) : 0;

  const score = Math.min(100, Math.round((critical * 35) + (high * 18) + (medium * 8) + (azureAlerts * 15) + (githubAlerts > 0 ? Math.min(20, githubAlerts * 4) : 0)));

  if (score >= 75) {
    return { score, label: 'Critical', trend: 'Rising' };
  }

  if (score >= 50) {
    return { score, label: 'High', trend: 'Rising' };
  }

  if (score >= 25) {
    return { score, label: 'Moderate', trend: 'Watchlist' };
  }

  if (score > 0) {
    return { score, label: 'Low', trend: 'Stable' };
  }

  return {
    score: 0,
    label: 'No Data Found',
    trend: 'No Data Found'
  };
}

async function getGitHubPullRequests() {
  const activeToken = githubTokenCache.token || GITHUB_TOKEN;

  if (!activeToken) {
    return [];
  }

  try {
    const account = await fetchGitHubJson('https://api.github.com/user', activeToken, {
      'X-GitHub-Api-Version': '2022-11-28'
    });
    const repos = await fetchGitHubJson('https://api.github.com/user/repos?per_page=25&sort=updated', activeToken, {
      'X-GitHub-Api-Version': '2022-11-28'
    });

    const repoPullRequests = await Promise.all(
      (Array.isArray(repos) ? repos : []).slice(0, 10).map(async (repo) => {
        const repoName = repo.name;
        const repoOwner = repo.owner?.login || account.login;

        if (!repoName || !repoOwner) {
          return [];
        }

        try {
          const pulls = await fetchGitHubJson(
            `https://api.github.com/repos/${repoOwner}/${repoName}/pulls?state=open&per_page=5`,
            activeToken,
            {
              'X-GitHub-Api-Version': '2022-11-28'
            }
          );

          return (Array.isArray(pulls) ? pulls : []).map((pull) => ({
            title: pull.title,
            state: pull.state,
            repository: repoName,
            owner: repoOwner,
            number: pull.number,
            created_at: pull.created_at,
            updated_at: pull.updated_at,
            html_url: pull.html_url,
            user: pull.user?.login || account.login || 'Unknown',
            comments: pull.comments || 0,
            base: pull.base?.ref || 'main',
            head: pull.head?.ref || 'feature'
          }));
        } catch (error) {
          return [];
        }
      })
    );

    const allPullRequests = repoPullRequests.flat();
    return allPullRequests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
  } catch (error) {
    return [];
  }
}

async function getGitHubPullRequestReview(owner, repo, pullNumber, token) {
  const [pullRequest, files] = await Promise.all([
    fetchGitHubJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`, token, {
      'X-GitHub-Api-Version': '2022-11-28'
    }),
    fetchGitHubJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`, token, {
      'X-GitHub-Api-Version': '2022-11-28'
    }).catch(() => [])
  ]);

  return {
    title: pullRequest.title,
    number: pullRequest.number,
    repository: repo,
    owner,
    state: pullRequest.state,
    user: pullRequest.user?.login || 'Unknown',
    createdAt: pullRequest.created_at,
    updatedAt: pullRequest.updated_at,
    base: pullRequest.base?.ref || 'main',
    head: pullRequest.head?.ref || 'feature',
    files: (Array.isArray(files) ? files : []).map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch || ''
    }))
  };
}

async function getGitHubActionsData() {
  const activeToken = githubTokenCache.token || GITHUB_TOKEN;

  if (!activeToken) {
    return [];
  }

  try {
    const account = await fetchGitHubJson('https://api.github.com/user', activeToken, {
      'X-GitHub-Api-Version': '2022-11-28'
    });
    const repos = await fetchGitHubJson('https://api.github.com/user/repos?per_page=20&sort=updated', activeToken, {
      'X-GitHub-Api-Version': '2022-11-28'
    });

    const repoActions = await Promise.all(
      (Array.isArray(repos) ? repos : []).slice(0, 10).map(async (repo) => {
        const repoName = repo.name;
        const repoOwner = repo.owner?.login || account.login;

        if (!repoName || !repoOwner) {
          return [];
        }

        try {
          const runsResponse = await fetchGitHubJson(
            `https://api.github.com/repos/${repoOwner}/${repoName}/actions/runs?per_page=5`,
            activeToken,
            {
              'X-GitHub-Api-Version': '2022-11-28'
            }
          );

          return (Array.isArray(runsResponse?.workflow_runs) ? runsResponse.workflow_runs : []).map((run) => ({
            name: run.name || 'GitHub Action',
            status: run.status || 'unknown',
            conclusion: run.conclusion || 'not_run',
            repository: repoName,
            event: run.event || 'push',
            branch: run.head_branch || 'main',
            createdAt: run.created_at,
            updatedAt: run.updated_at,
            htmlUrl: run.html_url,
            runNumber: run.run_number,
            actor: run.actor?.login || account.login || 'Unknown'
          }));
        } catch (error) {
          return [];
        }
      })
    );

    return repoActions.flat().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);
  } catch (error) {
    return [];
  }
}

const overview = {
  generatedAt: new Date().toISOString(),
  overallRisk: {
    score: 0,
    label: 'No Data Found',
    trend: 'No Data Found'
  },
  summary: {
    repos: 0,
    pipelines: 0,
    azureResources: 0,
    activeAlerts: 0,
    criticalFindings: 0,
    securityCoverage: 0,
    costEfficiency: 0,
    performance: 0,
    reliability: 0
  },
  systems: [
    {
      name: 'GitHub',
      status: 'Not connected',
      metrics: { coverage: 'No Data Found', pullRequests: 0, actions: 0 },
      signal: 'Connect GitHub to load repository and workflow data.'
    },
    {
      name: 'Azure Resources',
      status: 'Not connected',
      metrics: { subscriptions: 0, avgCpu: 'No Data Found', idleSpend: 'No Data Found' },
      signal: 'Connect Azure to load resource metrics and security details.'
    },
    {
      name: 'Defender for Cloud',
      status: 'No Data Found',
      metrics: { alerts: 0, critical: 0, remediations: 0 },
      signal: 'No security findings available until Azure is connected.'
    }
  ],
  controls: [],
  gitWorkflows: []
};

const recommendations = [];

const architecture = {
  layers: [
    { name: 'User / Admin', type: 'actor' },
    { name: 'AI Copilot UI', type: 'dashboard' },
    { name: 'AI Orchestrator', type: 'ai' },
    { name: 'GitHub', type: 'source' },
    { name: 'Azure Resources', type: 'cloud' },
    { name: 'Defender for Cloud', type: 'security' },
    { name: 'AI Analysis Engine', type: 'analysis' },
    { name: 'Recommendations', type: 'output' }
  ]
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Username and password are required.'
    });
  }

  const allowedUsers = ['admin', 'analyst', 'devops'];
  if (!allowedUsers.includes(String(username).trim().toLowerCase())) {
    return res.status(401).json({
      success: false,
      message: 'Invalid username or password.'
    });
  }

  return res.json({
    success: true,
    message: 'Login successful',
    redirectTo: '/dashboard',
    user: {
      username: String(username).trim(),
      role: 'Operator'
    }
  });
});

app.post('/api/register', (req, res) => {
  const { fullName, email, username, password, confirmPassword } = req.body || {};

  if (!fullName || !email || !username || !password || !confirmPassword) {
    return res.status(400).json({
      success: false,
      message: 'All registration fields are required.'
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 8 characters long.'
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: 'Passwords do not match.'
    });
  }

  return res.status(201).json({
    success: true,
    message: 'Registration successful. Please sign in.',
    user: {
      fullName: String(fullName).trim(),
      email: String(email).trim(),
      username: String(username).trim()
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-devsecops-copilot',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

async function sendEmailNotification({ to, subject, text, html }) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    return {
      success: false,
      configured: false,
      message: 'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in your .env file.'
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || smtpUser,
    to,
    subject,
    text,
    html: html || text
  });

  return {
    success: true,
    configured: true,
    messageId: info?.messageId || null
  };
}

app.post('/api/notifications/email', async (req, res) => {
  const { to, subject, text, html } = req.body || {};

  if (!to || !subject || !text) {
    return res.status(400).json({
      success: false,
      configured: false,
      message: 'Recipient, subject, and message text are required.'
    });
  }

  try {
    const result = await sendEmailNotification({ to, subject, text, html });
    if (!result.success) {
      return res.status(200).json(result);
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      configured: true,
      message: error.message || 'Unable to send email.'
    });
  }
});

app.get('/auth/github', (req, res) => {
  if (GITHUB_CLIENT_ID) {
    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', GITHUB_OAUTH_REDIRECT_URL);
    authUrl.searchParams.set('scope', 'read:user repo');
    authUrl.searchParams.set('allow_signup', 'true');

    return res.redirect(authUrl.toString());
  }

  const patUrl = new URL('https://github.com/settings/tokens/new');
  patUrl.searchParams.set('description', 'AI DevSecOps Copilot');
  patUrl.searchParams.set('scopes', 'read:user,repo,security_events');

  return res.redirect(patUrl.toString());
});

app.get('/auth/github/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`/login?error=${encodeURIComponent(error)}`);
  }

  if (!code || !GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return res.redirect('/login?error=GitHub+OAuth+is+not+fully+configured');
  }

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'ai-devsecops-copilot'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_OAUTH_REDIRECT_URL
      })
    });

    const tokenData = await tokenResponse.json();
    const token = tokenData.access_token;

    if (!token) {
      throw new Error(tokenData.error_description || 'GitHub token was not returned.');
    }

    githubTokenCache.token = token;
    return res.redirect('/dashboard?github=connected');
  } catch (err) {
    return res.redirect(`/login?error=${encodeURIComponent(err.message || 'GitHub login failed')}`);
  }
});

app.post('/api/github/token', (req, res) => {
  const { token } = req.body || {};

  if (!token || !String(token).trim()) {
    return res.status(400).json({ success: false, message: 'A GitHub token is required.' });
  }

  githubTokenCache.token = String(token).trim();
  return res.json({ success: true, message: 'GitHub token saved securely in memory for this session.' });
});

app.get('/api/overview', async (req, res) => {
  const github = await getGitHubAccountData();
  const azure = await getAzureResourceStatus();
  const response = {
    ...overview,
    github,
    azure
  };

  response.overallRisk = calculateOverallRisk(github, azure);

  if (github.connected) {
    response.summary = {
      ...overview.summary,
      repos: github.publicRepos || overview.summary.repos,
      activeAlerts: github.securitySummary?.totalAlerts || overview.summary.activeAlerts,
      criticalFindings: github.securitySummary?.critical || overview.summary.criticalFindings,
      githubUser: github.username
    };
  }

  if (azure.connected) {
    response.summary = {
      ...response.summary,
      azureResources: azure.resourcesCount || response.summary.azureResources,
      activeAlerts: Math.max(response.summary.activeAlerts || 0, azure.highRiskFindings || 0),
      criticalFindings: Math.max(response.summary.criticalFindings || 0, azure.highRiskFindings || 0),
      azureSubscription: azure.subscriptionName
    };

    response.systems = response.systems.map((system) => {
      if (system.name === 'Azure Resources') {
        return {
          ...system,
          status: 'Healthy',
          metrics: {
            subscriptions: 1,
            resources: azure.resourcesCount,
            securityAssessments: azure.securityAssessments
          },
          signal: `Connected to ${azure.subscriptionName} with ${azure.resourcesCount} resources under management.`
        };
      }

      if (system.name === 'Defender for Cloud') {
        return {
          ...system,
          status: azure.highRiskFindings > 0 ? 'Needs attention' : 'Healthy',
          metrics: {
            alerts: azure.highRiskFindings,
            critical: azure.highRiskFindings,
            subscriptions: 1
          },
          signal: azure.highRiskFindings > 0
            ? `Defender for Cloud detected ${azure.highRiskFindings} high-risk issues in ${azure.subscriptionName}.`
            : 'Defender for Cloud is clean for the connected Azure subscription.'
        };
      }

      return system;
    });
  }

  response.repoSecuritySummary = github.connected
    ? github.securitySummary || { totalAlerts: 0, reposWithAlerts: 0, critical: 0, high: 0, medium: 0 }
    : { totalAlerts: 0, reposWithAlerts: 0, critical: 0, high: 0, medium: 0 };

  res.json(response);
});

app.get('/api/github', async (req, res) => {
  const github = await getGitHubAccountData();
  res.json(github);
});

app.get('/api/github/pulls', async (req, res) => {
  const requestToken = req.headers['x-github-token'];
  const activeToken = requestToken || githubTokenCache.token || GITHUB_TOKEN;

  if (!activeToken) {
    return res.json([]);
  }

  githubTokenCache.token = String(activeToken).trim();
  const pullRequests = await getGitHubPullRequests();
  return res.json(pullRequests);
});

app.get('/api/github/pulls/:owner/:repo/:number/review', async (req, res) => {
  const requestToken = req.headers['x-github-token'];
  const activeToken = requestToken || githubTokenCache.token || GITHUB_TOKEN;
  const { owner, repo, number } = req.params;

  if (!activeToken || !owner || !repo || !number) {
    return res.status(401).json({
      success: false,
      message: 'Connect a GitHub token before reviewing a pull request.'
    });
  }

  githubTokenCache.token = String(activeToken).trim();

  try {
    const review = await getGitHubPullRequestReview(owner, repo, Number(number), activeToken);
    return res.json({ success: true, review });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Unable to load pull request review details.'
    });
  }
});

app.post('/api/github/pulls/:owner/:repo/:number/review', async (req, res) => {
  const requestToken = req.headers['x-github-token'];
  const activeToken = requestToken || githubTokenCache.token || GITHUB_TOKEN;
  const { owner, repo, number } = req.params;

  if (!activeToken || !owner || !repo || !number) {
    return res.status(401).json({
      success: false,
      message: 'Connect a GitHub token before approving a pull request.'
    });
  }

  githubTokenCache.token = String(activeToken).trim();

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ai-devsecops-copilot',
        Authorization: `Bearer ${activeToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event: 'APPROVE',
        body: 'Approved from AI DevSecOps Copilot.'
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(describeGitHubPermissionIssue(data.message || 'Unable to approve this pull request.', data));
    }

    return res.json({ success: true, approved: true, review: data });
  } catch (error) {
    const message = String(error.message || 'Unable to approve this pull request.');
    const isValidationFailure = /unprocessable entity|validation failed|already approved|review already exists/i.test(message);

    return res.status(isValidationFailure ? 422 : 400).json({
      success: false,
      message: describeGitHubPermissionIssue(message, null)
    });
  }
});

app.post('/api/github/pulls/:owner/:repo/:number/merge', async (req, res) => {
  const requestToken = req.headers['x-github-token'];
  const activeToken = requestToken || githubTokenCache.token || GITHUB_TOKEN;
  const { owner, repo, number } = req.params;

  if (!activeToken || !owner || !repo || !number) {
    return res.status(401).json({
      success: false,
      message: 'Connect a GitHub token before merging a pull request.'
    });
  }

  githubTokenCache.token = String(activeToken).trim();

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}/merge`, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ai-devsecops-copilot',
        Authorization: `Bearer ${activeToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        commit_title: `Merge pull request #${number}`,
        merge_method: 'squash'
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(describeGitHubPermissionIssue(data.message || 'Unable to merge this pull request.', data));
    }

    return res.json({ success: true, merged: true, result: data });
  } catch (error) {
    const message = String(error.message || 'Unable to merge this pull request.');
    const isValidationFailure = /unprocessable entity|validation failed|already approved|review already exists/i.test(message);

    return res.status(isValidationFailure ? 422 : 400).json({
      success: false,
      message: describeGitHubPermissionIssue(message, null)
    });
  }
});

app.get('/api/github/actions', async (req, res) => {
  const requestToken = req.headers['x-github-token'];
  const activeToken = requestToken || githubTokenCache.token || GITHUB_TOKEN;

  if (!activeToken) {
    return res.status(401).json({
      success: false,
      message: 'Connect a GitHub token before loading GitHub Actions data.'
    });
  }

  githubTokenCache.token = String(activeToken).trim();
  const actions = await getGitHubActionsData();
  return res.json(actions);
});

// Azure DevOps token cache (in-memory for session use)
const azureTokenCache = { token: null, organization: null };

async function fetchAzureDevOpsJson(url, token) {
  const basic = Buffer.from(`:${token}`).toString('base64');
  const headers = {
    Accept: 'application/json',
    Authorization: `Basic ${basic}`
  };

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Azure DevOps request failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function getAzureRepos(token, organization) {
  if (!token || !organization) return [];

  // Try the common DevOps API endpoint formats. Some organizations use dev.azure.com, others use {org}.visualstudio.com
  const candidates = [
    `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/repositories?api-version=6.0`,
    `https://${encodeURIComponent(organization)}.visualstudio.com/_apis/git/repositories?api-version=6.0`
  ];

  let lastError = null;
  for (const url of candidates) {
    try {
      const data = await fetchAzureDevOpsJson(url, token);
      const repos = Array.isArray(data.value) ? data.value : [];

      return repos.map((r) => ({
        id: r.id,
        name: r.name,
        project: r.project?.name || r.project?.id || 'unknown',
        defaultBranch: r.defaultBranch || '',
        webUrl: r.webUrl || r.remoteUrl || '',
        size: r.size || 0
      }));
    } catch (err) {
      lastError = err;
      // try next candidate
    }
  }

  // If none succeeded, throw the last error to the caller for clearer diagnostics
  throw lastError || new Error('Unable to query Azure Repos');
}

app.post('/api/azure/token', (req, res) => {
  const { token, organization } = req.body || {};

  if (!token || !String(token).trim() || !organization || !String(organization).trim()) {
    return res.status(400).json({ success: false, message: 'Azure DevOps PAT and organization are required.' });
  }

  azureTokenCache.token = String(token).trim();
  azureTokenCache.organization = String(organization).trim();

  return res.json({ success: true, message: 'Azure DevOps token saved in memory for this session.' });
});

app.get('/api/azure/repos', async (req, res) => {
  const requestToken = req.headers['x-azure-token'];
  const requestOrg = req.headers['x-azure-organization'];
  const activeToken = requestToken || azureTokenCache.token || process.env.AZURE_DEVOPS_TOKEN;
  const organization = requestOrg || azureTokenCache.organization || process.env.AZURE_ORGANIZATION;

  if (!activeToken || !organization) {
    return res.status(401).json({ success: false, message: 'Connect an Azure DevOps personal access token and organization before listing repositories.' });
  }

  try {
    const repos = await getAzureRepos(activeToken, organization);
    return res.json({ success: true, organization, repos });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Unable to load Azure Repos.' });
  }
});

app.get('/api/recommendations', (req, res) => {
  res.json(recommendations);
});

app.get('/api/architecture', (req, res) => {
  res.json(architecture);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/repos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'repos.html'));
});

app.get('/repo-details', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'repo-details.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AI DevSecOps Copilot running at http://localhost:${PORT}`);
  });
}

module.exports = { app, setGitHubTokenForTests };

const formatPercent = (value) => `${value}%`;
const GITHUB_TOKEN_STORAGE_KEY = 'ai-devsecops-github-token';

function getStoredGithubToken() {
  try {
    const savedLocalToken = localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY);
    if (savedLocalToken) {
      return savedLocalToken;
    }
  } catch (error) {
    // localStorage may be unavailable in some browsers; fall through to sessionStorage
  }

  try {
    return sessionStorage.getItem(GITHUB_TOKEN_STORAGE_KEY) || '';
  } catch (error) {
    return '';
  }
}

function setStoredGithubToken(token) {
  const cleanedToken = token ? String(token).trim() : '';

  try {
    if (cleanedToken) {
      localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, cleanedToken);
    } else {
      localStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
    }
  } catch (error) {
    // localStorage may be blocked; keep the in-memory session fallback
  }

  try {
    if (cleanedToken) {
      sessionStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, cleanedToken);
    } else {
      sessionStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
    }
  } catch (error) {
    // ignore sessionStorage access failures
  }
}

async function hydrateGitHubTokenFromStorage() {
  const token = getStoredGithubToken();
  if (!token) return;

  try {
    await fetch('/api/github/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
  } catch (error) {
    console.warn('Unable to restore the saved GitHub PAT on load.', error);
  }
}

async function loadData() {
  await hydrateGitHubTokenFromStorage();

  try {
    const [overviewRes, recommendationsRes] = await Promise.all([
      fetch('/api/overview'),
      fetch('/api/recommendations')
    ]);

    const overview = await overviewRes.json();
    const recommendations = await recommendationsRes.json();

    renderOverview(overview);
    renderConnectedSystems(overview);
    renderSecurity(overview);
    renderRecommendations(recommendations);
    renderGitHubStatus(overview.github, overview);
  } catch (error) {
    console.error('Failed to load app data:', error);
    document.body.innerHTML = '<div style="padding: 40px; color: white;">Unable to load dashboard data.</div>';
  }
}

function bindGitHubConnectControls() {
  const connectGithubButton = document.getElementById('connectGithubButton');
  const tokenInput = document.getElementById('githubTokenInput');
  const copyPatChecklistDashboardButton = document.getElementById('copyPatChecklistDashboard');
  const savedGithubToken = getStoredGithubToken();

  if (tokenInput && savedGithubToken) {
    tokenInput.value = savedGithubToken;
    const parent = tokenInput.closest('.github-connect-box');
    if (parent && !parent.querySelector('.github-connected-badge')) {
      const connectedBadge = document.createElement('div');
      connectedBadge.className = 'github-connected-badge';
      connectedBadge.textContent = 'GitHub connected';
      parent.insertBefore(connectedBadge, parent.firstChild);
    }
  }

  const renderGitHubStatusMessage = (message, isError = false) => {
    const parent = tokenInput?.closest('.github-connect-box');
    if (!parent) return;

    let statusNode = parent.querySelector('.github-status-message');
    if (!statusNode) {
      statusNode = document.createElement('div');
      statusNode.className = 'github-status-message';
      parent.appendChild(statusNode);
    }

    statusNode.textContent = message;
    statusNode.classList.toggle('error', isError);
  };

  const PAT_CHECKLIST_TEXT = [
    'GitHub PAT checklist:',
    '- read:user',
    '- repo',
    '- workflow',
    '- security_events',
    '- Use a token that has access to your own repositories only.'
  ].join('\n');

  copyPatChecklistDashboardButton?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(PAT_CHECKLIST_TEXT);
      alert('PAT checklist copied to clipboard.');
    } catch (error) {
      alert('Unable to copy automatically. Please copy the checklist manually.');
    }
  });

  if (!connectGithubButton) return;

  connectGithubButton.onclick = async () => {
    const token = tokenInput?.value.trim();
    if (!token) {
      renderGitHubStatusMessage('Paste a GitHub personal access token to connect your account.', true);
      return;
    }

    setStoredGithubToken(token);

    try {
      const response = await fetch('/api/github/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'GitHub connection failed');
      }

      const parent = tokenInput?.closest('.github-connect-box');
      if (parent && !parent.querySelector('.github-connected-badge')) {
        const badge = document.createElement('div');
        badge.className = 'github-connected-badge';
        badge.textContent = 'GitHub connected';
        parent.insertBefore(badge, parent.firstChild);
      }

      renderGitHubStatusMessage('GitHub connected successfully.');
      setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      renderGitHubStatusMessage(error.message || 'Failed to connect GitHub.', true);
    }
  };
}

function bindRepoSourceTabs() {
  document.querySelectorAll('.repo-source-tab').forEach((button) => {
    button.onclick = () => {
      const { source } = button.dataset;
      document.querySelectorAll('.repo-source-tab').forEach((tabButton) => {
        tabButton.classList.toggle('active', tabButton === button);
      });
      document.querySelectorAll('.repo-source-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.panel === source);
      });
    };
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function loadGitHubActions() {
  const panel = document.querySelector('.github-tab-panel[data-panel="gitactions"]');
  const list = panel?.querySelector('#githubActionsList');

  if (!list) return;

  list.innerHTML = '<p class="empty-state">Loading GitHub Actions from GitHub...</p>';

  try {
    const token = getStoredGithubToken();
    const response = await fetch('/api/github/actions', {
      headers: token ? { 'x-github-token': token } : {}
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const rawText = await response.text();
      throw new Error(rawText.includes('GitHub') || rawText.includes('login')
        ? 'Connect a GitHub token with workflow access to load GitHub Actions data.'
        : 'GitHub Actions could not be loaded.');
    }

    const payload = await response.json();
    const actions = Array.isArray(payload) ? payload : [];

    if (!response.ok) {
      throw new Error(payload.message || 'Unable to load GitHub Actions.');
    }

    if (!actions.length) {
      list.innerHTML = '<p class="empty-state">No GitHub Actions runs were found for the connected GitHub account.</p>';
      return;
    }

    list.innerHTML = actions.map((action) => `
      <div class="pull-request-item">
        <div class="pull-request-header">
          <a href="${action.htmlUrl}" target="_blank" rel="noreferrer">${action.name}</a>
          <span class="table-status ${action.conclusion === 'success' ? 'ok' : action.conclusion === 'failure' ? 'warning' : 'neutral'}">${action.conclusion || action.status}</span>
        </div>
        <div class="pull-request-meta">
          <span>Repo: ${action.repository}</span>
          <span>Run: #${action.runNumber}</span>
        </div>
        <div class="pull-request-meta">
          <span>Branch: ${action.branch}</span>
          <span>Event: ${action.event}</span>
        </div>
        <div class="pull-request-meta">
          <span>Actor: ${action.actor}</span>
          <span>Updated: ${new Date(action.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    `).join('');
  } catch (error) {
    const message = error.message && error.message.toLowerCase().includes('connect')
      ? 'Connect a GitHub token with workflow access to load GitHub Actions data.'
      : error.message || 'GitHub Actions could not be loaded.';
    list.innerHTML = `<p class="empty-state error-text">${message}</p>`;
  }
}

async function openPullRequestReview(owner, repo, number, button) {
  const token = getStoredGithubToken();
  const card = button.closest('.pull-request-item');
  if (!card) return;

  const reviewContainer = card.querySelector('.pull-request-review');
  if (reviewContainer) {
    reviewContainer.classList.toggle('hidden');
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'pull-request-review';
  panel.innerHTML = '<p class="empty-state">Loading PR diff...</p>';
  card.appendChild(panel);

  try {
    const response = await fetch(`/api/github/pulls/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(number)}/review`, {
      headers: { 'x-github-token': token }
    });
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.message || 'Unable to load PR review details.');
    }

    const files = Array.isArray(payload.review?.files) ? payload.review.files : [];
    const diffHtml = files.length
      ? files.map((file) => `
          <div class="review-file-block">
            <div class="review-file-header">
              <strong>${escapeHtml(file.filename)}</strong>
              <span>${file.status} · +${file.additions} / -${file.deletions}</span>
            </div>
            <pre class="review-patch">${escapeHtml(file.patch || 'No patch preview available.')}</pre>
          </div>
        `).join('')
      : '<p class="empty-state">No file changes were detected for this pull request.</p>';

    panel.innerHTML = `
      <div class="review-actions">
        <button type="button" class="primary-btn small-btn approve-pr-btn" data-owner="${escapeHtml(owner)}" data-repo="${escapeHtml(repo)}" data-number="${number}">Approve</button>
        <button type="button" class="secondary-btn small-btn merge-pr-btn" data-owner="${escapeHtml(owner)}" data-repo="${escapeHtml(repo)}" data-number="${number}">Merge code</button>
      </div>
      <div class="review-diff">${diffHtml}</div>
    `;
  } catch (error) {
    panel.innerHTML = `<p class="empty-state error-text">${error.message || 'Unable to open review details.'}</p>`;
  }
}

async function notifyUserByEmail(subject, body) {
  try {
    const storedUser = JSON.parse(sessionStorage.getItem('ai-devsecops-user') || 'null');
    const email = storedUser?.email || 'admin@devsecops.local';

    if (email && email !== 'admin@devsecops.local') {
      try {
        const response = await fetch('/api/notifications/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: email,
            subject,
            text: body
          })
        });

        const data = await response.json().catch(() => ({}));
        if (response.ok && data.success) {
          return;
        }
      } catch (error) {
        console.warn('Server-side email delivery failed, falling back to mailto.', error);
      }
    }

    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(body);
    const mailtoLink = `mailto:${email}?subject=${encodedSubject}&body=${encodedBody}`;
    window.location.href = mailtoLink;
  } catch (error) {
    alert(`${subject}\n\n${body}`);
  }
}

async function approvePullRequest(owner, repo, number, button) {
  const token = getStoredGithubToken();
  const card = button.closest('.pull-request-item');
  const status = card?.querySelector('.pull-request-status');

  try {
    const response = await fetch(`/api/github/pulls/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(number)}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-token': token
      }
    });
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.message || 'Unable to approve the pull request.');
    }

    if (status) {
      status.textContent = 'Approved';
      status.className = 'table-status ok pull-request-status';
    }

    button.textContent = 'Approved';
    button.disabled = true;
    await notifyUserByEmail(
      'Pull request approved',
      `Pull request #${number} for ${repo} was approved successfully.\n\nRepository: ${repo}\nOwner: ${owner}\nStatus: Approved`
    );
  } catch (error) {
    alert(error.message || 'Approval failed.');
  }
}

async function mergePullRequest(owner, repo, number, button) {
  const token = getStoredGithubToken();
  const card = button.closest('.pull-request-item');
  const status = card?.querySelector('.pull-request-status');

  try {
    const response = await fetch(`/api/github/pulls/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(number)}/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-token': token
      }
    });
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.message || 'Unable to merge the pull request.');
    }

    if (status) {
      status.textContent = 'Merged';
      status.className = 'table-status ok pull-request-status';
    }

    button.textContent = 'Merged';
    button.disabled = true;
    alert('Merge is completed Successfully');
    await notifyUserByEmail(
      'Pull request merged',
      `Pull request #${number} for ${repo} was merged successfully.\n\nRepository: ${repo}\nOwner: ${owner}\nStatus: Merged`
    );
  } catch (error) {
    alert(error.message || 'Merge failed.');
  }
}

function bindGitHubTabs() {
  document.querySelectorAll('.github-tab').forEach((button) => {
    button.onclick = () => {
      const { tab } = button.dataset;
      document.querySelectorAll('.github-tab').forEach((tabButton) => {
        tabButton.classList.toggle('active', tabButton === button);
      });
      document.querySelectorAll('.github-tab-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.panel === tab);
      });

      if (tab === 'gitactions') {
        loadGitHubActions();
      }
    };
  });
}

async function loadPullRequestsList() {
  const button = document.getElementById('loadPullRequestsButton');
  const list = document.getElementById('pullRequestsList');

  if (!button || !list) return;

  const token = getStoredGithubToken();

  button.disabled = true;
  button.textContent = 'Loading...';
  list.innerHTML = '<p class="empty-state">Loading pull requests from GitHub...</p>';

  try {
    const response = await fetch('/api/github/pulls', {
      headers: token ? { 'x-github-token': token } : {}
    });
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      const rawText = await response.text();
      throw new Error(rawText.includes('GitHub') || rawText.includes('login')
        ? 'The app is serving an outdated page. Refresh the dashboard after reconnecting the server.'
        : 'GitHub pull requests could not be loaded.');
    }

    const payload = await response.json();
    const pullRequests = Array.isArray(payload) ? payload : [];

    if (!response.ok) {
      throw new Error(payload.message || 'Unable to load pull requests.');
    }

    if (!pullRequests.length) {
      list.innerHTML = '<p class="empty-state error-text">No pull requests are in Queue</p>';
      return;
    }

    list.innerHTML = pullRequests.map((pr) => `
      <div class="pull-request-item">
        <div class="pull-request-header">
          <a href="${pr.html_url}" target="_blank" rel="noreferrer">${pr.title}</a>
          <span class="table-status ${pr.state === 'open' ? 'ok' : 'neutral'} pull-request-status">${pr.state}</span>
        </div>
        <div class="pull-request-meta">
          <span>Repo: ${pr.repository}</span>
          <span>Created: ${new Date(pr.created_at).toLocaleDateString()}</span>
        </div>
        <div class="pull-request-meta">
          <span>Author: ${pr.user}</span>
          <span>Comments: ${pr.comments}</span>
        </div>
        <button type="button" class="secondary-btn review-pr-btn" data-owner="${escapeHtml(pr.owner || '')}" data-repo="${escapeHtml(pr.repository || '')}" data-number="${pr.number || ''}">Review &amp; Approve</button>
      </div>
    `).join('');
  } catch (error) {
    const message = error.message && error.message.toLowerCase().includes('connect')
      ? 'Connect a GitHub token with repo access to load pull request details.'
      : error.message || 'GitHub pull requests could not be loaded.';
    list.innerHTML = `<p class="empty-state error-text">${message}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = 'Pull request';
  }
}

function bindPullRequests() {
  const button = document.getElementById('loadPullRequestsButton');
  if (!button) return;

  button.onclick = () => loadPullRequestsList();

  document.addEventListener('click', async (event) => {
    const reviewButton = event.target.closest('.review-pr-btn');
    if (reviewButton) {
      const { owner, repo, number } = reviewButton.dataset;
      await openPullRequestReview(owner, repo, number, reviewButton);
      return;
    }

    const approveButton = event.target.closest('.approve-pr-btn');
    if (approveButton) {
      const { owner, repo, number } = approveButton.dataset;
      await approvePullRequest(owner, repo, number, approveButton);
      return;
    }

    const mergeButton = event.target.closest('.merge-pr-btn');
    if (mergeButton) {
      const { owner, repo, number } = mergeButton.dataset;
      await mergePullRequest(owner, repo, number, mergeButton);
    }
  });

  loadPullRequestsList();
}

function renderOverview(data) {
  const riskScore = document.getElementById('risk-score');
  const riskLabel = document.getElementById('risk-label');
  const riskTrend = document.getElementById('risk-trend');

  const repoCount = data.github && data.github.connected ? data.github.publicRepos : data.summary.repos;

  riskScore.textContent = data.overallRisk.score;
  riskLabel.textContent = data.overallRisk.label;
  riskTrend.textContent = data.overallRisk.trend;

  document.getElementById('repos').textContent = repoCount;
  document.getElementById('pipelines').textContent = Number(data.summary.pipelines) > 0 ? data.summary.pipelines : 'No Data Found';
  document.getElementById('alerts').textContent = Number(data.summary.activeAlerts) > 0 ? data.summary.activeAlerts : 'No Data Found';

  document.getElementById('securityCoverage').textContent = formatPercent(data.summary.securityCoverage);
  document.getElementById('costEfficiency').textContent = formatPercent(data.summary.costEfficiency);
  document.getElementById('performance').textContent = formatPercent(data.summary.performance);
  document.getElementById('reliability').textContent = formatPercent(data.summary.reliability);

  const controlsList = document.getElementById('controls');
  controlsList.innerHTML = data.controls.map((control) => `<li>${control}</li>`).join('');

  bindRepoSourceTabs();
  bindGitHubTabs();
  bindGitHubConnectControls();
  bindPullRequests();

  // Load coverage to show under control coverage
  (async function loadCoverage() {
    try {
      const resp = await fetch('/api/coverage');
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload.success) return;
      const coverage = Number(payload.coverage || 0);
      const codecovUrl = payload.codecovUrl || '';
      const controlsList = document.getElementById('controls');
      const existing = controlsList.querySelector('.coverage-control');
      const link = codecovUrl ? `<a class="coverage-link" href="${codecovUrl}" target="_blank" rel="noreferrer">View details</a>` : '';
      const item = `<li class="coverage-control" data-codecov-url="${codecovUrl}"><strong>Code coverage</strong>: ${coverage}% ${link}</li>`;
      if (existing) existing.outerHTML = item;
      else controlsList.insertAdjacentHTML('afterbegin', item);

      // Make the entire control clickable (open Codecov in a new tab)
      const controlEl = controlsList.querySelector('.coverage-control');
      if (controlEl) {
        controlEl.style.cursor = codecovUrl ? 'pointer' : 'default';
        controlEl.addEventListener('click', (ev) => {
          // If user clicked the internal anchor, let it handle navigation normally
          if (ev.target && ev.target.closest && ev.target.closest('.coverage-link')) return;
          if (codecovUrl) window.open(codecovUrl, '_blank');
        });
      }
    } catch (err) {
      // ignore
    }
  })();
}

function renderConnectedSystems(data) {
  const systemsContainer = document.getElementById('systems');
  if (!systemsContainer) return;

  const repoRows = (data.github && data.github.repos ? data.github.repos : []).map((repo) => {
    const statusLabel = repo.securityStatus === 'healthy' ? 'Healthy' : repo.securityStatus === 'attention-needed' ? 'Attention' : repo.securityStatus === 'permission-limited' ? 'Limited' : 'Unknown';
    const badgeClass = repo.securityStatus === 'healthy' ? 'ok' : repo.securityStatus === 'attention-needed' ? 'warning' : repo.securityStatus === 'permission-limited' ? 'neutral' : 'neutral';
    const repoName = encodeURIComponent(repo.name || 'repo');
    const repoUrl = `/repo-details?source=github&name=${repoName}`;
    return `
      <tr>
        <td><a href="${repoUrl}">${repo.name}</a></td>
        <td>${repo.language || 'Unknown'}</td>
        <td><span class="table-status ${badgeClass}">${statusLabel}</span></td>
        <td>${repo.alerts || 0}</td>
      </tr>
    `;
  }).join('');

  const azureRepoRows = (data.azure && data.azure.connected ? (data.azure.resourceNames || []) : []).map((resource) => {
    const type = resource.toLowerCase().includes('sql') ? 'SQL' : resource.toLowerCase().includes('app') ? 'App Service' : resource.toLowerCase().includes('storage') ? 'Storage' : 'Resource';
    const encodedResource = encodeURIComponent(resource);
    return `
      <tr>
        <td><a href="/repo-details?source=azure&name=${encodedResource}">${resource}</a></td>
        <td>${type}</td>
        <td><span class="table-status ok">Healthy</span></td>
        <td>0</td>
      </tr>
    `;
  }).join('');

  const workflowRows = (data.gitWorkflows || []).map((workflow) => {
    const statusClass = workflow.status === 'Healthy' ? 'ok' : workflow.status === 'Warning' ? 'warning' : 'neutral';
    const repoUrl = (data.github?.repos?.[0]?.htmlUrl || data.github?.repos?.[0]?.html_url || 'https://github.com');
    const workflowUrl = `${repoUrl}/actions/workflows/${workflow.workflow}`;
    return `
      <li class="workflow-item">
        <div class="workflow-main">
          <strong>${workflow.environment}</strong>
          <a href="${workflowUrl}" target="_blank" rel="noreferrer">${workflow.workflow}</a>
        </div>
        <div class="workflow-meta">
          <span class="table-status ${statusClass}">${workflow.status}</span>
          <small>Last run: ${workflow.lastRun}</small>
          <small>Branch: ${workflow.branch}</small>
        </div>
      </li>
    `;
  }).join('');

  systemsContainer.innerHTML = data.systems
    .map((system) => {
      const statusClass = system.status.toLowerCase().replace(/\s+/g, '-');
      const metricsHtml = Object.entries(system.metrics)
        .map(([key, value]) => `<div class="metric-inline"><span>${key}</span><strong>${value}</strong></div>`)
        .join('');

      const repoHtml = system.name === 'GitHub'
        ? `
          <div class="github-connect-box">
            <div class="connect-row">
              <input id="githubTokenInput" type="password" placeholder="Paste GitHub token" />
              <button type="button" id="connectGithubButton">Connect GitHub</button>
            </div>
            <div class="token-actions">
              <button type="button" class="small-btn" id="copyPatChecklistDashboard">Copy PAT checklist</button>
              <a class="small-link" href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" target="_blank" rel="noreferrer">GitHub docs</a>
            </div>

            <div class="repo-source-tabs">
              <button type="button" class="repo-source-tab active" data-source="github">GitHub</button>
              <button type="button" class="repo-source-tab" data-source="azure">Azure</button>
            </div>

            <div class="repo-source-panel active" data-panel="github">
              <div class="github-tabs">
                <button type="button" class="github-tab active" data-tab="repos">Repos</button>
                <button type="button" class="github-tab" data-tab="gitworkflows">Gitworkflows</button>
                <button type="button" class="github-tab" data-tab="gitactions">Git Actions</button>
              </div>
              <div class="github-tab-panel active" data-panel="repos">
                ${repoRows ? `
                  <table class="repo-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Language</th>
                        <th>Security</th>
                        <th>Alerts</th>
                      </tr>
                    </thead>
                    <tbody>${repoRows}</tbody>
                  </table>
                ` : '<p class="empty-state">No repositories available yet. Connect a valid GitHub token to load your repo data.</p>'}
              </div>
              <div class="github-tab-panel" data-panel="gitworkflows">
                <ul class="workflow-list">${workflowRows || '<li class="empty-state">No workflow data available.</li>'}</ul>
              </div>
              <div class="github-tab-panel" data-panel="gitactions">
                <div id="githubActionsList">
                  <p class="empty-state">Loading GitHub Actions...</p>
                </div>
              </div>
            </div>

            <div class="repo-source-panel" data-panel="azure">
              <table class="repo-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Alerts</th>
                  </tr>
                </thead>
                <tbody>${azureRepoRows || '<tr><td colspan="4"><p class="empty-state">No Azure repositories available yet.</p></td></tr>'}</tbody>
              </table>
            </div>
          </div>
        `
        : '';

      return `
        <div class="system-card">
          <h4>${system.name}</h4>
          <span class="status ${statusClass}">${system.status}</span>
          ${metricsHtml}
          ${repoHtml}
          <div class="signal">${system.signal}</div>
        </div>
      `;
    })
    .join('');

  bindRepoSourceTabs();
  bindGitHubTabs();
  bindGitHubConnectControls();

  // Load Azure Repos and insert them into the Azure Resources card if available
  (async function loadAzureReposInSystems() {
    try {
      const resp = await fetch('/api/azure/repos');
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload.success) return;

      const repos = Array.isArray(payload.repos) ? payload.repos : [];
      if (!repos.length) return;

      const systemsContainer = document.getElementById('systems');
      if (!systemsContainer) return;

      const azureCard = Array.from(systemsContainer.querySelectorAll('.system-card')).find((c) => (c.querySelector('h4') || {}).textContent === 'Azure Resources');
      if (!azureCard) return;

      const tableHtml = `
        <table class="repo-table">
          <thead>
            <tr><th>Name</th><th>Project</th><th>Default branch</th></tr>
          </thead>
          <tbody>
            ${repos.map((r) => `<tr><td><a href="${r.webUrl || '#'}" target="_blank" rel="noreferrer">${escapeHtml(r.name)}</a></td><td>${escapeHtml(r.project)}</td><td>${escapeHtml(r.defaultBranch || '')}</td></tr>`).join('')}
          </tbody>
        </table>
      `;

      const existing = azureCard.querySelector('.azure-repos-list');
      if (existing) existing.innerHTML = tableHtml;
      else {
        const container = document.createElement('div');
        container.className = 'azure-repos-list';
        container.innerHTML = tableHtml;
        azureCard.appendChild(container);
      }
    } catch (error) {
      // quietly ignore errors — Azure Repos are optional
    }
  })();
}

function renderGitHubStatus(github, data) {
  const container = document.getElementById('systems');
  if (!container) return;

  if (github && github.connected) {
    const githubCard = `
      <div class="system-card">
        <h4>GitHub Account</h4>
        <span class="status">Connected</span>
        <div class="metric-inline"><span>Username</span><strong>${github.username}</strong></div>
        <div class="metric-inline"><span>Followers</span><strong>${github.followers}</strong></div>
        <div class="metric-inline"><span>Following</span><strong>${github.following}</strong></div>
        <div class="metric-inline"><span>Public Repos</span><strong>${github.publicRepos}</strong></div>
      </div>
    `;

    if (!container.innerHTML.includes('GitHub Account')) {
      container.insertAdjacentHTML('beforeend', githubCard);
    }
  }

  const securitySummaryContainer = document.getElementById('repo-security-summary');
  if (securitySummaryContainer) {
    const summary = data && data.repoSecuritySummary ? data.repoSecuritySummary : { totalAlerts: 0, reposWithAlerts: 0, critical: 0, high: 0, medium: 0 };
    securitySummaryContainer.innerHTML = `
      <div class="security-card warning">
        <span>Total alerts</span>
        <strong>${summary.totalAlerts}</strong>
      </div>
      <div class="security-card danger">
        <span>Critical</span>
        <strong>${summary.critical}</strong>
      </div>
      <div class="security-card alert">
        <span>High</span>
        <strong>${summary.high}</strong>
      </div>
      <div class="security-card neutral">
        <span>Medium</span>
        <strong>${summary.medium}</strong>
      </div>
      <div class="security-card success">
        <span>Repos with alerts</span>
        <strong>${summary.reposWithAlerts}</strong>
      </div>
    `;
  }
}

function renderSecurity(data) {
  const container = document.getElementById('security-content');
  if (!container) return;

  const azure = data?.azure || {};
  const subscriptionUuid = azure.subscriptionId || '';
  const portalUrl = azure.connected && subscriptionUuid
    ? `https://portal.azure.com/#@microsoft.onmicrosoft.com/resource/subscriptions/${encodeURIComponent(subscriptionUuid)}/providers/Microsoft.Security/overview`
    : 'https://portal.azure.com/#view/Microsoft_Azure_Security/SecurityMenuBlade/~/0';

  container.innerHTML = `
    <div class="security-page-grid">
      <div class="panel security-portal-panel">
        <h4>Defender for Cloud</h4>
        <div class="security-portal-status">
          <span class="status ${azure.connected ? 'ok' : 'neutral'}">${azure.connected ? 'Connected' : 'Not connected'}</span>
        </div>
        <p class="security-portal-copy">
          ${azure.connected
            ? `Connected to ${azure.subscriptionName || 'Azure subscription'} with ${azure.highRiskFindings || 0} high-risk findings.`
            : 'Connect Azure in the environment settings to link Defender for Cloud to your Azure portal.'}
        </p>
        <a class="primary-btn security-portal-link" href="${portalUrl}" target="_blank" rel="noreferrer">
          Open in Azure portal
        </a>
      </div>

      <div class="panel security-summary-panel">
        <h4>Security summary</h4>
        <div class="summary-stat-list">
          <div><span>Subscription</span><strong>${azure.subscriptionName || 'Not connected'}</strong></div>
          <div><span>Resources</span><strong>${azure.resourcesCount || 0}</strong></div>
          <div><span>Assessments</span><strong>${azure.securityAssessments || 0}</strong></div>
          <div><span>High-risk findings</span><strong>${azure.highRiskFindings || 0}</strong></div>
        </div>
      </div>
    </div>
  `;
}

function renderRecommendations(items) {
  const container = document.getElementById('recommendations-list');
  container.innerHTML = items
    .map(
      (item) => `
        <div class="recommendation-item">
          <div class="priority-badge priority-${item.priority.toLowerCase()}">${item.priority}</div>
          <div class="rec-content">
            <h4>${item.title}</h4>
            <p>${item.description}</p>
          </div>
          <div class="rec-meta">
            <span><strong>Impact:</strong> ${item.impact}</span>
            <span><strong>Effort:</strong> ${item.effort}</span>
            <span><strong>Owner:</strong> ${item.owner}</span>
            <span><strong>Due:</strong> ${item.due}</span>
          </div>
        </div>
      `
    )
    .join('');
}

function updateProfileSummary(user) {
  const profileName = document.getElementById('profileName');
  const profileRole = document.getElementById('profileRole');
  const profileAvatar = document.getElementById('profileAvatar');

  if (!profileName || !profileRole || !profileAvatar) return;

  const fullName = user?.fullName || user?.username || 'User';
  profileName.textContent = fullName;
  profileRole.textContent = user?.role || 'Operator';

  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'U';

  profileAvatar.textContent = initials;
}

function populateProfileForm() {
  const storedUser = JSON.parse(sessionStorage.getItem('ai-devsecops-user') || 'null') || {
    fullName: 'Admin User',
    username: 'admin',
    email: 'admin@devsecops.local',
    role: 'Operator'
  };

  const fullNameField = document.getElementById('profileFullName');
  const emailField = document.getElementById('profileEmail');
  const usernameField = document.getElementById('profileUsername');
  const roleField = document.getElementById('profileRoleSelect');

  if (fullNameField) fullNameField.value = storedUser.fullName || '';
  if (emailField) emailField.value = storedUser.email || '';
  if (usernameField) usernameField.value = storedUser.username || '';
  if (roleField) roleField.value = storedUser.role || 'Operator';
}

function initProfileMenu() {
  const profileToggle = document.getElementById('profileToggle');
  const profileDropdown = document.getElementById('profileDropdown');
  const settingsButton = document.getElementById('settingsButton');
  const leftSidebarSettingsButton = document.getElementById('leftSidebarSettingsButton');
  const profileSettingsButton = document.getElementById('profileSettingsButton');
  const logoutButton = document.getElementById('logoutButton');
  const settingsBlade = document.getElementById('settingsBlade');
  const closeSettingsBlade = document.getElementById('closeSettingsBlade');
  const cancelSettingsBlade = document.getElementById('cancelSettingsBlade');
  const settingsForm = document.getElementById('settingsForm');
  const settingsFormMessage = document.getElementById('settingsFormMessage');
  const profileModal = document.getElementById('profileModal');
  const closeProfileModal = document.getElementById('closeProfileModal');
  const cancelProfileModal = document.getElementById('cancelProfileModal');
  const profileSettingsForm = document.getElementById('profileSettingsForm');
  const profileFormMessage = document.getElementById('profileFormMessage');

  const setProfileMessage = (message, type = 'success') => {
    if (!profileFormMessage) return;
    profileFormMessage.textContent = message;
    profileFormMessage.classList.remove('success', 'error');
    profileFormMessage.classList.add(type, 'show');
  };

  const storedUser = JSON.parse(sessionStorage.getItem('ai-devsecops-user') || 'null');
  if (storedUser) {
    updateProfileSummary(storedUser);
  }

  const openProfileModal = () => {
    populateProfileForm();
    profileFormMessage?.classList.remove('show', 'success', 'error');
    profileFormMessage && (profileFormMessage.textContent = '');
    profileModal?.classList.remove('hidden');
    profileModal?.setAttribute('aria-hidden', 'false');
    profileDropdown?.classList.remove('open');
    profileToggle?.setAttribute('aria-expanded', 'false');
  };

  const openSettingsBlade = () => {
    settingsFormMessage?.classList.remove('show', 'success', 'error');
    settingsFormMessage && (settingsFormMessage.textContent = '');
    settingsBlade?.classList.remove('hidden');
    settingsBlade?.setAttribute('aria-hidden', 'false');
    profileDropdown?.classList.remove('open');
    profileToggle?.setAttribute('aria-expanded', 'false');
  };

  const closeProfileModalHandler = () => {
    profileModal?.classList.add('hidden');
    profileModal?.setAttribute('aria-hidden', 'true');
  };

  const closeSettingsBladeHandler = () => {
    settingsBlade?.classList.add('hidden');
    settingsBlade?.setAttribute('aria-hidden', 'true');
  };

  profileToggle?.addEventListener('click', () => {
    const isOpen = profileDropdown.classList.toggle('open');
    profileToggle.setAttribute('aria-expanded', String(isOpen));
  });

  settingsButton?.addEventListener('click', openSettingsBlade);
  leftSidebarSettingsButton?.addEventListener('click', openSettingsBlade);
  profileSettingsButton?.addEventListener('click', openProfileModal);
  closeSettingsBlade?.addEventListener('click', closeSettingsBladeHandler);
  cancelSettingsBlade?.addEventListener('click', closeSettingsBladeHandler);
  closeProfileModal?.addEventListener('click', closeProfileModalHandler);
  cancelProfileModal?.addEventListener('click', closeProfileModalHandler);
  profileModal?.addEventListener('click', (event) => {
    if (event.target === profileModal) {
      closeProfileModalHandler();
    }
  });
  settingsBlade?.addEventListener('click', (event) => {
    if (event.target === settingsBlade) {
      closeSettingsBladeHandler();
    }
  });

  document.addEventListener('click', (event) => {
    if (!profileDropdown || !profileToggle) return;
    if (!profileDropdown.contains(event.target) && !profileToggle.contains(event.target)) {
      profileDropdown.classList.remove('open');
      profileToggle.setAttribute('aria-expanded', 'false');
    }
  });

  profileSettingsForm?.addEventListener('submit', (event) => {
    event.preventDefault();

    const fullName = document.getElementById('profileFullName').value.trim();
    const email = document.getElementById('profileEmail').value.trim();
    const username = document.getElementById('profileUsername').value.trim();

    if (!fullName || !email || !username) {
      setProfileMessage('Please fill in all required profile fields.', 'error');
      return;
    }

    const updatedUser = {
      fullName,
      email,
      username,
      role: document.getElementById('profileRoleSelect').value || 'Operator'
    };

    sessionStorage.setItem('ai-devsecops-user', JSON.stringify(updatedUser));
    updateProfileSummary(updatedUser);
    setProfileMessage('Profile saved successfully.', 'success');

    setTimeout(() => {
      closeProfileModalHandler();
    }, 900);
  });

  settingsForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    settingsFormMessage?.classList.remove('show', 'success', 'error');
    settingsFormMessage && (settingsFormMessage.textContent = 'Settings saved successfully.');
    settingsFormMessage?.classList.add('show', 'success');

    setTimeout(() => {
      closeSettingsBladeHandler();
    }, 800);
  });

  logoutButton?.addEventListener('click', () => {
    sessionStorage.removeItem('ai-devsecops-user');
    localStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
    window.location.href = '/login';
  });
}

function initPageNavigation() {
  const navLinks = document.querySelectorAll('.nav a');
  const sections = document.querySelectorAll('.page-section');
  const pageHeader = document.getElementById('pageHeader');
  const pageTitle = document.getElementById('pageTitle');
  const pageEyebrow = document.getElementById('pageEyebrow');

  const headerMap = {
    overview: { eyebrow: 'Operations Intelligence', title: 'AI Security Command Center' },
    repos: { eyebrow: 'Repository View', title: 'Repositories' },
    security: { eyebrow: 'Security View', title: 'Security' },
    integrations: { eyebrow: 'Systems View', title: 'Integrations' },
    recommendations: { eyebrow: 'AI Insights', title: 'AI recommendations' }
  };

  const showSection = (targetId) => {
    sections.forEach((section) => {
      const isActive = section.id === targetId;
      section.classList.toggle('hidden', !isActive);
      section.classList.toggle('active', isActive);
    });

    navLinks.forEach((link) => {
      const isActive = link.getAttribute('href') === `#${targetId}`;
      link.classList.toggle('active', isActive);
    });

    const headerContent = headerMap[targetId] || headerMap.overview;
    if (pageEyebrow) pageEyebrow.textContent = headerContent.eyebrow;
    if (pageTitle) pageTitle.textContent = headerContent.title;
    if (pageHeader) {
      pageHeader.classList.toggle('hidden', targetId !== 'overview');
    }
  };

  navLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('#')) return;

      const targetId = href.replace('#', '');
      if (!targetId) return;
      event.preventDefault();
      showSection(targetId);
      history.replaceState(null, '', `#${targetId}`);
    });
  });

  const initialHash = window.location.hash.replace('#', '');
  if (initialHash && document.getElementById(initialHash)) {
    showSection(initialHash);
  } else {
    showSection('overview');
  }
}

loadData();
initProfileMenu();
initPageNavigation();

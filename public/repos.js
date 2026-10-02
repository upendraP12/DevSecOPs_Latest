async function loadRepoPage() {
  const container = document.getElementById('reposContent');
  if (!container) return;

  try {
    const response = await fetch('/api/overview');
    const data = await response.json();

    const githubRepos = Array.isArray(data.github?.repos) ? data.github.repos : [];
    const azureResources = Array.isArray(data.azure?.resourceNames) ? data.azure.resourceNames : [];

    const githubCards = githubRepos.length
      ? githubRepos.map((repo) => {
          const repoLink = `/repo-details?source=github&name=${encodeURIComponent(repo.name)}`;
          return `
            <a href="${repoLink}" class="repo-item-card repo-item-link">
              <div class="repo-item-header">
                <strong>${repo.name}</strong>
                <span class="table-status ${repo.securityStatus === 'healthy' ? 'ok' : repo.securityStatus === 'attention-needed' ? 'warning' : 'neutral'}">
                  ${repo.securityStatus === 'healthy' ? 'Healthy' : repo.securityStatus === 'attention-needed' ? 'Attention' : 'Limited'}
                </span>
              </div>
              <div class="repo-item-meta">
                <span>Language: ${repo.language || 'Unknown'}</span>
                <span>Alerts: ${repo.alerts || 0}</span>
              </div>
              <div class="repo-item-meta">
                <span>Updated: ${repo.updatedAt ? new Date(repo.updatedAt).toLocaleDateString() : 'N/A'}</span>
                <span>Visibility: ${repo.private ? 'Private' : 'Public'}</span>
              </div>
            </a>
          `;
        }).join('')
      : '<div class="repo-detail-empty"><h3>No GitHub repositories connected.</h3></div>';

    const azureCards = azureResources.length
      ? azureResources.map((resource) => `
          <div class="repo-item-card">
            <div class="repo-item-header">
              <strong>${resource}</strong>
              <span class="table-status ok">Healthy</span>
            </div>
            <div class="repo-item-meta">
              <span>Type: ${resource.toLowerCase().includes('sql') ? 'SQL' : resource.toLowerCase().includes('app') ? 'App Service' : 'Resource'}</span>
              <span>Alerts: 0</span>
            </div>
          </div>
        `).join('')
      : '<div class="repo-detail-empty"><h3>No Azure repositories connected.</h3></div>';

    container.innerHTML = `
      <div class="repo-detail-grid">
        <div class="repo-detail-blade">
          <h3>GitHub</h3>
          <div class="repo-detail-list repo-list-stack">
            ${githubCards}
          </div>
        </div>
        <div class="repo-detail-blade">
          <h3>Azure Repos</h3>
          <div class="repo-detail-list repo-list-stack">
            ${azureCards}
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Failed to load repo portfolio', error);
    container.innerHTML = '<div class="repo-detail-empty"><h3>Unable to load repository details.</h3></div>';
  }
}

loadRepoPage();

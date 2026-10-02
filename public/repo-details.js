const params = new URLSearchParams(window.location.search);
const source = params.get('source');
const repoName = params.get('name');
const repoTitle = document.getElementById('repoDetailsTitle');
const repoDetailContent = document.getElementById('repoDetailContent');

const renderPlaceholder = (message) => {
  repoDetailContent.innerHTML = `
    <div class="repo-detail-empty">
      <h3>${message}</h3>
    </div>
  `;
};

const renderBlade = (title, details) => `
  <div class="repo-detail-blade">
    <h3>${title}</h3>
    <div class="repo-detail-list">
      ${details.map(([label, value]) => `
        <div class="repo-detail-row">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `).join('')}
    </div>
  </div>
`;

async function loadRepositoryDetails() {
  if (!source || !repoName) {
    repoTitle.textContent = 'Repository details';
    renderPlaceholder('No repository selected.');
    return;
  }

  const decodedName = decodeURIComponent(repoName);
  repoTitle.textContent = decodedName;

  try {
    const response = await fetch('/api/overview');
    const data = await response.json();

    const githubRepos = Array.isArray(data.github?.repos) ? data.github.repos : [];
    const selectedRepo = githubRepos.find((repo) => repo.name === decodedName) || githubRepos[0] || null;
    const azureResources = Array.isArray(data.azure?.resourceNames) ? data.azure.resourceNames : [];
    const selectedAzureResource = azureResources.find((resource) => resource === decodedName) || azureResources[0] || null;

    if (source === 'github') {
      const repoDetails = selectedRepo
        ? [
            ['Repository', selectedRepo.name],
            ['Owner', data.github?.username || 'GitHub'],
            ['Language', selectedRepo.language || 'Unknown'],
            ['Visibility', selectedRepo.private ? 'Private' : 'Public'],
            ['Status', selectedRepo.securityStatus === 'healthy' ? 'Healthy' : selectedRepo.securityStatus === 'attention-needed' ? 'Attention needed' : 'Limited'],
            ['Alerts', selectedRepo.alerts || 0],
            ['Updated', selectedRepo.updatedAt ? new Date(selectedRepo.updatedAt).toLocaleString() : 'N/A']
          ]
        : [
            ['Repository', decodedName],
            ['Owner', data.github?.username || 'GitHub'],
            ['Language', 'Not available'],
            ['Visibility', 'Unknown'],
            ['Status', 'Not connected'],
            ['Alerts', '0'],
            ['Updated', 'N/A']
          ];

      const accountDetails = data.github
        ? [
            ['Username', data.github.username || 'Unknown'],
            ['Name', data.github.name || 'Unknown'],
            ['Followers', data.github.followers || 0],
            ['Following', data.github.following || 0],
            ['Public Repos', data.github.publicRepos || 0],
            ['Status', data.github.connected ? 'Connected' : 'Not connected']
          ]
        : [
            ['Username', 'Not connected'],
            ['Name', 'Not connected'],
            ['Followers', '0'],
            ['Following', '0'],
            ['Public Repos', '0'],
            ['Status', 'Not connected']
          ];

      const azureDetails = selectedAzureResource
        ? [
            ['Resource', selectedAzureResource],
            ['Type', selectedAzureResource.toLowerCase().includes('sql') ? 'SQL' : selectedAzureResource.toLowerCase().includes('app') ? 'App Service' : 'Resource'],
            ['Region', data.azure?.location || 'Unknown'],
            ['Status', 'Healthy'],
            ['Alerts', '0'],
            ['Owner', 'Azure']
          ]
        : [
            ['Resource', 'Azure integration pending'],
            ['Type', 'N/A'],
            ['Region', 'N/A'],
            ['Status', 'Not connected'],
            ['Alerts', '0'],
            ['Owner', 'Azure']
          ];

      repoDetailContent.innerHTML = `
        <div class="repo-detail-grid">
          ${renderBlade('GitHub', repoDetails)}
          ${renderBlade('GitHub Account', accountDetails)}
        </div>
      `;
      return;
    }

    const resourceDetails = selectedAzureResource
      ? [
          ['Resource', selectedAzureResource],
          ['Type', selectedAzureResource.toLowerCase().includes('sql') ? 'SQL' : selectedAzureResource.toLowerCase().includes('app') ? 'App Service' : 'Resource'],
          ['Region', data.azure?.location || 'Unknown'],
          ['Status', 'Healthy'],
          ['Alerts', '0'],
          ['Owner', 'Azure']
        ]
      : [
          ['Resource', decodedName],
          ['Type', 'Azure resource'],
          ['Region', 'Unknown'],
          ['Status', 'Not connected'],
          ['Alerts', '0'],
          ['Owner', 'Azure']
        ];

    const repoDetails = selectedRepo
      ? [
          ['Repository', selectedRepo.name],
          ['Owner', data.github?.username || 'GitHub'],
          ['Language', selectedRepo.language || 'Unknown'],
          ['Visibility', selectedRepo.private ? 'Private' : 'Public'],
          ['Status', selectedRepo.securityStatus === 'healthy' ? 'Healthy' : selectedRepo.securityStatus === 'attention-needed' ? 'Attention needed' : 'Limited'],
          ['Alerts', selectedRepo.alerts || 0],
          ['Updated', selectedRepo.updatedAt ? new Date(selectedRepo.updatedAt).toLocaleString() : 'N/A']
        ]
      : [
          ['Repository', decodedName],
          ['Owner', data.github?.username || 'GitHub'],
          ['Language', 'Not available'],
          ['Visibility', 'Unknown'],
          ['Status', 'Not connected'],
          ['Alerts', '0'],
          ['Updated', 'N/A']
        ];

    repoDetailContent.innerHTML = `
      <div class="repo-detail-grid">
        ${renderBlade('Azure', resourceDetails)}
        ${renderBlade('GitHub', repoDetails)}
      </div>
    `;
  } catch (error) {
    console.error('Unable to load repository details:', error);
    repoDetailContent.innerHTML = `
      <div class="repo-detail-empty">
        <h3>Unable to load repository details.</h3>
      </div>
    `;
  }
}

loadRepositoryDetails();

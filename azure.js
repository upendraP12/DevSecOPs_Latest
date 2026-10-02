function buildAzureStatusSummary(data) {
  if (!data || !data.connected) {
    return {
      connected: false,
      subscriptionId: '',
      subscriptionName: '',
      resourcesCount: 0,
      securityAssessments: 0,
      highRiskFindings: 0,
      resourceNames: [],
      message: data?.message || 'Azure is not configured. Add AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_SUBSCRIPTION_ID.'
    };
  }

  return {
    connected: true,
    subscriptionId: data.subscriptionId || '',
    subscriptionName: data.subscriptionName || 'Azure subscription',
    resourcesCount: Number(data.resourcesCount || 0),
    securityAssessments: Number(data.securityAssessments || 0),
    highRiskFindings: Number(data.highRiskFindings || 0),
    resourceNames: Array.isArray(data.resourceNames) ? data.resourceNames : [],
    message: data.message || 'Connected to Azure'
  };
}

async function getAzureResourceStatus() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

  if (!tenantId || !clientId || !clientSecret || !subscriptionId) {
    return buildAzureStatusSummary({
      connected: false,
      message: 'Azure is not configured. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_SUBSCRIPTION_ID in your .env file.'
    });
  }

  try {
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://management.azure.com/.default',
        grant_type: 'client_credentials'
      })
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || 'Unable to authenticate with Azure');
    }

    const accessToken = tokenData.access_token;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };

    const [subscriptionResponse, resourcesResponse, assessmentsResponse] = await Promise.all([
      fetch(`https://management.azure.com/subscriptions/${subscriptionId}?api-version=2020-01-01`, { headers }),
      fetch(`https://management.azure.com/subscriptions/${subscriptionId}/resources?api-version=2021-04-01`, { headers }),
      fetch(`https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Security/assessments?api-version=2021-06-01`, { headers })
    ]);

    const subscription = await subscriptionResponse.json();
    const resources = await resourcesResponse.json();
    const assessments = await assessmentsResponse.json();

    if (!subscriptionResponse.ok || !resourcesResponse.ok || !assessmentsResponse.ok) {
      throw new Error((subscription.error && subscription.error.message) || (resources.error && resources.error.message) || (assessments.error && assessments.error.message) || 'Azure API request failed');
    }

    const resourceNames = Array.isArray(resources.value)
      ? resources.value
          .slice(0, 6)
          .map((resource) => resource.name || resource.id || 'unnamed-resource')
      : [];

    const assessmentList = Array.isArray(assessments.value) ? assessments.value : [];
    const highRiskFindings = assessmentList.filter((assessment) => {
      const status = assessment.properties?.status?.code || '';
      const severity = String(assessment.properties?.metadata?.severity || '').toLowerCase();
      return status === 'Unhealthy' || severity === 'high' || severity === 'critical';
    }).length;

    return buildAzureStatusSummary({
      connected: true,
      subscriptionId,
      subscriptionName: subscription.displayName || subscription.name || 'Azure subscription',
      resourcesCount: Array.isArray(resources.value) ? resources.value.length : 0,
      securityAssessments: assessmentList.length,
      highRiskFindings,
      resourceNames,
      message: 'Connected to Azure subscription'
    });
  } catch (error) {
    return buildAzureStatusSummary({
      connected: false,
      message: `Unable to connect to Azure. ${error.message || 'Check your tenant, client ID, secret, and subscription ID.'}`
    });
  }
}

module.exports = {
  buildAzureStatusSummary,
  getAzureResourceStatus
};

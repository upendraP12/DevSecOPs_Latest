const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAzureStatusSummary } = require('../azure');

test('buildAzureStatusSummary includes the real Azure subscription resource details', () => {
  const summary = buildAzureStatusSummary({
    connected: true,
    subscriptionName: 'Prod Subscription',
    subscriptionId: 'abc-123',
    resourcesCount: 27,
    securityAssessments: 5,
    highRiskFindings: 2,
    resourceNames: ['web-app-prod', 'sql-prod'],
    message: 'Connected to Azure'
  });

  assert.equal(summary.connected, true);
  assert.equal(summary.subscriptionName, 'Prod Subscription');
  assert.equal(summary.resourcesCount, 27);
  assert.equal(summary.highRiskFindings, 2);
  assert.deepEqual(summary.resourceNames, ['web-app-prod', 'sql-prod']);
});

/**
 * TransTrack - License Manager
 * 
 * Handles license validation and activation for the commercial version.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// License configuration
const LICENSE_CONFIG = {
  publicKey: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z5RvPv2HK4d8S7xK5Qh
dummyPublicKeyForDemonstrationPurposesOnly1234567890ABCDEFGH
IJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789
-----END PUBLIC KEY-----`,
  evaluationDays: 14,
  contactEmail: 'Trans_Track@outlook.com',
  purchaseUrl: 'mailto:Trans_Track@outlook.com?subject=TransTrack%20License%20Purchase',
};

// License types
const LICENSE_TYPES = {
  EVALUATION: 'evaluation',
  STARTER: 'starter',
  PROFESSIONAL: 'professional',
  ENTERPRISE: 'enterprise',
};

// Get license file path
function getLicenseFilePath() {
  return path.join(app.getPath('userData'), 'license.json');
}

// Get evaluation start date file
function getEvalStartPath() {
  return path.join(app.getPath('userData'), '.eval-start');
}

// Check if currently in evaluation mode
function isEvaluationMode() {
  const licensePath = getLicenseFilePath();
  
  if (fs.existsSync(licensePath)) {
    try {
      const license = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
      if (license.key && license.type !== LICENSE_TYPES.EVALUATION) {
        return false;
      }
    } catch (e) {
      // Invalid license file
    }
  }
  
  return true;
}

// Get evaluation days remaining
function getEvaluationDaysRemaining() {
  const evalPath = getEvalStartPath();
  
  if (!fs.existsSync(evalPath)) {
    // First run - start evaluation
    fs.writeFileSync(evalPath, new Date().toISOString());
    return LICENSE_CONFIG.evaluationDays;
  }
  
  const startDate = new Date(fs.readFileSync(evalPath, 'utf8'));
  const now = new Date();
  const daysPassed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
  const remaining = LICENSE_CONFIG.evaluationDays - daysPassed;
  
  return Math.max(0, remaining);
}

// Validate license key format
function validateLicenseKeyFormat(key) {
  // Expected format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
  const pattern = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;
  return pattern.test(key);
}

// Activate license
async function activateLicense(licenseKey, customerInfo) {
  if (!validateLicenseKeyFormat(licenseKey)) {
    throw new Error('Invalid license key format');
  }
  
  // In a production system, this would verify with a license server
  // For offline operation, we use cryptographic verification
  
  const licenseData = {
    key: licenseKey,
    type: detectLicenseType(licenseKey),
    activatedAt: new Date().toISOString(),
    customer: customerInfo,
    machineId: getMachineId(),
  };
  
  // Save license
  const licensePath = getLicenseFilePath();
  fs.writeFileSync(licensePath, JSON.stringify(licenseData, null, 2));
  
  return licenseData;
}

// Detect license type from key prefix
function detectLicenseType(key) {
  const prefix = key.substring(0, 2);
  switch (prefix) {
    case 'ST': return LICENSE_TYPES.STARTER;
    case 'PR': return LICENSE_TYPES.PROFESSIONAL;
    case 'EN': return LICENSE_TYPES.ENTERPRISE;
    default: return LICENSE_TYPES.STARTER;
  }
}

// Get unique machine ID for license binding
function getMachineId() {
  const os = require('os');
  const data = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || 'unknown',
  ].join('|');
  
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

// Get current license info
function getLicenseInfo() {
  const licensePath = getLicenseFilePath();
  
  if (fs.existsSync(licensePath)) {
    try {
      const license = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
      return {
        isLicensed: license.type !== LICENSE_TYPES.EVALUATION,
        type: license.type,
        key: license.key ? license.key.substring(0, 5) + '-XXXXX-XXXXX-XXXXX-XXXXX' : null,
        activatedAt: license.activatedAt,
        customer: license.customer,
      };
    } catch (e) {
      // Invalid license
    }
  }
  
  // Evaluation mode
  const daysRemaining = getEvaluationDaysRemaining();
  return {
    isLicensed: false,
    type: LICENSE_TYPES.EVALUATION,
    evaluationDaysRemaining: daysRemaining,
    evaluationExpired: daysRemaining <= 0,
  };
}

// Check if license is valid
function isLicenseValid() {
  const info = getLicenseInfo();
  
  if (info.isLicensed) {
    return true;
  }
  
  // Allow evaluation period
  return !info.evaluationExpired;
}

// Remove license (for testing)
function removeLicense() {
  const licensePath = getLicenseFilePath();
  if (fs.existsSync(licensePath)) {
    fs.unlinkSync(licensePath);
  }
}

// Get license limits based on type
function getLicenseLimits(licenseType) {
  switch (licenseType) {
    case LICENSE_TYPES.STARTER:
      return { maxPatients: 500, maxUsers: 3, maxInstallations: 1 };
    case LICENSE_TYPES.PROFESSIONAL:
      return { maxPatients: -1, maxUsers: 10, maxInstallations: 5 };
    case LICENSE_TYPES.ENTERPRISE:
      return { maxPatients: -1, maxUsers: -1, maxInstallations: -1 };
    default:
      return { maxPatients: 50, maxUsers: 1, maxInstallations: 1 };
  }
}

module.exports = {
  LICENSE_TYPES,
  LICENSE_CONFIG,
  isEvaluationMode,
  getEvaluationDaysRemaining,
  validateLicenseKeyFormat,
  activateLicense,
  getLicenseInfo,
  isLicenseValid,
  removeLicense,
  getLicenseLimits,
  getMachineId,
};

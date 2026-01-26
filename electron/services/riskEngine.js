/**
 * TransTrack - Operational Risk Intelligence Engine
 * 
 * Continuously evaluates transplant waitlist and workflows to surface
 * latent OPERATIONAL risks (not clinical risks).
 * 
 * Risk Categories:
 * - Documentation delays
 * - Expiring testing/evaluations
 * - Coordinator overload
 * - Status churn
 * - Fragile coordination handoffs
 */

const { getDatabase } = require('../database/init');

// Risk thresholds (configurable)
const RISK_THRESHOLDS = {
  // Days before evaluation expires to flag as at-risk
  EVALUATION_EXPIRY_WARNING_DAYS: 30,
  EVALUATION_EXPIRY_CRITICAL_DAYS: 14,
  
  // Status changes in last 30 days to flag as churn
  STATUS_CHURN_WARNING: 3,
  STATUS_CHURN_CRITICAL: 5,
  
  // Days without documentation update
  DOCUMENTATION_STALE_WARNING_DAYS: 60,
  DOCUMENTATION_STALE_CRITICAL_DAYS: 90,
  
  // Patients per coordinator threshold
  COORDINATOR_LOAD_WARNING: 25,
  COORDINATOR_LOAD_CRITICAL: 40,
  
  // Readiness window shrinking (days)
  READINESS_SHRINKING_THRESHOLD: 7,
};

// Risk levels
const RISK_LEVEL = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NONE: 'none',
};

/**
 * Main risk assessment for a single patient
 */
function assessPatientOperationalRisk(patient) {
  const risks = [];
  const now = new Date();
  
  // 1. Evaluation Expiry Risk
  if (patient.last_evaluation_date) {
    const evalDate = new Date(patient.last_evaluation_date);
    const daysSinceEval = Math.floor((now - evalDate) / (1000 * 60 * 60 * 24));
    const daysUntilExpiry = 365 - daysSinceEval; // Assume annual evaluations
    
    if (daysUntilExpiry <= RISK_THRESHOLDS.EVALUATION_EXPIRY_CRITICAL_DAYS) {
      risks.push({
        type: 'evaluation_expiring',
        level: RISK_LEVEL.CRITICAL,
        title: 'Evaluation Expiring Soon',
        description: `Patient evaluation expires in ${daysUntilExpiry} days`,
        daysRemaining: daysUntilExpiry,
        actionRequired: 'Schedule re-evaluation immediately',
      });
    } else if (daysUntilExpiry <= RISK_THRESHOLDS.EVALUATION_EXPIRY_WARNING_DAYS) {
      risks.push({
        type: 'evaluation_expiring',
        level: RISK_LEVEL.HIGH,
        title: 'Evaluation Expiring',
        description: `Patient evaluation expires in ${daysUntilExpiry} days`,
        daysRemaining: daysUntilExpiry,
        actionRequired: 'Schedule re-evaluation',
      });
    }
  } else {
    risks.push({
      type: 'no_evaluation',
      level: RISK_LEVEL.HIGH,
      title: 'No Evaluation on Record',
      description: 'Patient has no evaluation date recorded',
      actionRequired: 'Document evaluation date or schedule evaluation',
    });
  }
  
  // 2. Documentation Staleness Risk
  const lastUpdate = patient.updated_date ? new Date(patient.updated_date) : null;
  if (lastUpdate) {
    const daysSinceUpdate = Math.floor((now - lastUpdate) / (1000 * 60 * 60 * 24));
    
    if (daysSinceUpdate >= RISK_THRESHOLDS.DOCUMENTATION_STALE_CRITICAL_DAYS) {
      risks.push({
        type: 'documentation_stale',
        level: RISK_LEVEL.HIGH,
        title: 'Documentation Critically Outdated',
        description: `No updates in ${daysSinceUpdate} days`,
        daysSinceUpdate,
        actionRequired: 'Review and update patient documentation',
      });
    } else if (daysSinceUpdate >= RISK_THRESHOLDS.DOCUMENTATION_STALE_WARNING_DAYS) {
      risks.push({
        type: 'documentation_stale',
        level: RISK_LEVEL.MEDIUM,
        title: 'Documentation May Be Outdated',
        description: `No updates in ${daysSinceUpdate} days`,
        daysSinceUpdate,
        actionRequired: 'Consider reviewing patient documentation',
      });
    }
  }
  
  // 3. Incomplete Critical Data Risk
  const missingFields = [];
  if (!patient.blood_type) missingFields.push('Blood Type');
  if (!patient.hla_typing) missingFields.push('HLA Typing');
  if (!patient.date_added_to_waitlist) missingFields.push('Waitlist Date');
  if (!patient.medical_urgency) missingFields.push('Medical Urgency');
  
  if (missingFields.length > 0) {
    risks.push({
      type: 'incomplete_data',
      level: missingFields.length >= 3 ? RISK_LEVEL.HIGH : RISK_LEVEL.MEDIUM,
      title: 'Missing Critical Data',
      description: `Missing: ${missingFields.join(', ')}`,
      missingFields,
      actionRequired: 'Complete patient data entry',
    });
  }
  
  // 4. Inactivity Risk (for active patients)
  if (patient.waitlist_status === 'active') {
    // Check for factors that might lead to becoming inactive
    const inactivityRisks = [];
    
    if (patient.compliance_score && patient.compliance_score < 5) {
      inactivityRisks.push('Low compliance score');
    }
    if (patient.comorbidity_score && patient.comorbidity_score > 7) {
      inactivityRisks.push('High comorbidity burden');
    }
    
    if (inactivityRisks.length > 0) {
      risks.push({
        type: 'inactivity_risk',
        level: RISK_LEVEL.MEDIUM,
        title: 'Risk of Becoming Inactive',
        description: inactivityRisks.join('; '),
        factors: inactivityRisks,
        actionRequired: 'Monitor closely and address risk factors',
      });
    }
  }
  
  // Calculate overall risk level
  let overallLevel = RISK_LEVEL.NONE;
  if (risks.some(r => r.level === RISK_LEVEL.CRITICAL)) {
    overallLevel = RISK_LEVEL.CRITICAL;
  } else if (risks.some(r => r.level === RISK_LEVEL.HIGH)) {
    overallLevel = RISK_LEVEL.HIGH;
  } else if (risks.some(r => r.level === RISK_LEVEL.MEDIUM)) {
    overallLevel = RISK_LEVEL.MEDIUM;
  } else if (risks.length > 0) {
    overallLevel = RISK_LEVEL.LOW;
  }
  
  return {
    patientId: patient.id,
    patientName: `${patient.first_name} ${patient.last_name}`,
    patientMRN: patient.patient_id,
    overallRiskLevel: overallLevel,
    riskCount: risks.length,
    risks,
    assessedAt: now.toISOString(),
  };
}

/**
 * Analyze waitlist segment for operational patterns
 */
function analyzeWaitlistSegment(patients, segmentName) {
  const analysis = {
    segmentName,
    totalPatients: patients.length,
    findings: [],
  };
  
  if (patients.length === 0) return analysis;
  
  // 1. Status Churn Analysis
  // (In a real system, this would query status change history)
  const activePatients = patients.filter(p => p.waitlist_status === 'active');
  const inactivePatients = patients.filter(p => p.waitlist_status !== 'active');
  const inactiveRate = (inactivePatients.length / patients.length) * 100;
  
  if (inactiveRate > 30) {
    analysis.findings.push({
      type: 'high_inactive_rate',
      level: RISK_LEVEL.HIGH,
      title: 'High Inactive Rate in Segment',
      description: `${inactiveRate.toFixed(1)}% of patients are inactive`,
      metric: inactiveRate,
      recommendation: 'Review segment for systemic issues',
    });
  }
  
  // 2. Readiness Window Analysis
  const now = new Date();
  const patientsNearEvalExpiry = patients.filter(p => {
    if (!p.last_evaluation_date) return true;
    const evalDate = new Date(p.last_evaluation_date);
    const daysSince = Math.floor((now - evalDate) / (1000 * 60 * 60 * 24));
    return (365 - daysSince) <= 30;
  });
  
  const expiryRate = (patientsNearEvalExpiry.length / patients.length) * 100;
  if (expiryRate > 20) {
    analysis.findings.push({
      type: 'shrinking_readiness',
      level: RISK_LEVEL.HIGH,
      title: 'Shrinking Readiness Windows',
      description: `${expiryRate.toFixed(1)}% of patients have evaluations expiring within 30 days`,
      patientsAffected: patientsNearEvalExpiry.length,
      recommendation: 'Prioritize re-evaluations for this segment',
    });
  }
  
  // 3. Documentation Gap Analysis
  const patientsWithStaleData = patients.filter(p => {
    if (!p.updated_date) return true;
    const updateDate = new Date(p.updated_date);
    const daysSince = Math.floor((now - updateDate) / (1000 * 60 * 60 * 24));
    return daysSince > 60;
  });
  
  const staleRate = (patientsWithStaleData.length / patients.length) * 100;
  if (staleRate > 25) {
    analysis.findings.push({
      type: 'documentation_gap',
      level: RISK_LEVEL.MEDIUM,
      title: 'Documentation Gaps Detected',
      description: `${staleRate.toFixed(1)}% of patients have outdated documentation`,
      patientsAffected: patientsWithStaleData.length,
      recommendation: 'Schedule documentation review for segment',
    });
  }
  
  // 4. Priority Distribution Analysis
  const priorityDistribution = {
    critical: patients.filter(p => (p.priority_score || 0) >= 80).length,
    high: patients.filter(p => (p.priority_score || 0) >= 60 && (p.priority_score || 0) < 80).length,
    medium: patients.filter(p => (p.priority_score || 0) >= 40 && (p.priority_score || 0) < 60).length,
    low: patients.filter(p => (p.priority_score || 0) < 40).length,
  };
  
  analysis.priorityDistribution = priorityDistribution;
  
  // Flag if too many critical patients
  const criticalRate = (priorityDistribution.critical / patients.length) * 100;
  if (criticalRate > 15) {
    analysis.findings.push({
      type: 'high_acuity_segment',
      level: RISK_LEVEL.HIGH,
      title: 'High Acuity Concentration',
      description: `${criticalRate.toFixed(1)}% of segment is critical priority`,
      recommendation: 'Review resource allocation for high-acuity care',
    });
  }
  
  return analysis;
}

/**
 * Generate full operational risk report
 */
async function generateOperationalRiskReport() {
  const db = getDatabase();
  
  const patients = db.prepare('SELECT * FROM patients WHERE waitlist_status = ?').all('active');
  
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalActivePatients: patients.length,
      criticalRiskPatients: 0,
      highRiskPatients: 0,
      mediumRiskPatients: 0,
      lowRiskPatients: 0,
    },
    patientRisks: [],
    segmentAnalysis: [],
    actionItems: [],
  };
  
  // Assess each patient
  for (const patient of patients) {
    const assessment = assessPatientOperationalRisk(patient);
    report.patientRisks.push(assessment);
    
    // Update summary counts
    switch (assessment.overallRiskLevel) {
      case RISK_LEVEL.CRITICAL:
        report.summary.criticalRiskPatients++;
        break;
      case RISK_LEVEL.HIGH:
        report.summary.highRiskPatients++;
        break;
      case RISK_LEVEL.MEDIUM:
        report.summary.mediumRiskPatients++;
        break;
      case RISK_LEVEL.LOW:
        report.summary.lowRiskPatients++;
        break;
    }
  }
  
  // Analyze by organ type
  const organTypes = [...new Set(patients.map(p => p.organ_needed).filter(Boolean))];
  for (const organType of organTypes) {
    const segmentPatients = patients.filter(p => p.organ_needed === organType);
    const analysis = analyzeWaitlistSegment(segmentPatients, `Organ: ${organType}`);
    report.segmentAnalysis.push(analysis);
  }
  
  // Analyze by blood type
  const bloodTypes = [...new Set(patients.map(p => p.blood_type).filter(Boolean))];
  for (const bloodType of bloodTypes) {
    const segmentPatients = patients.filter(p => p.blood_type === bloodType);
    const analysis = analyzeWaitlistSegment(segmentPatients, `Blood Type: ${bloodType}`);
    report.segmentAnalysis.push(analysis);
  }
  
  // Generate prioritized action items
  const criticalPatients = report.patientRisks
    .filter(r => r.overallRiskLevel === RISK_LEVEL.CRITICAL)
    .sort((a, b) => b.riskCount - a.riskCount);
  
  for (const patient of criticalPatients.slice(0, 10)) {
    for (const risk of patient.risks.filter(r => r.level === RISK_LEVEL.CRITICAL)) {
      report.actionItems.push({
        priority: 'URGENT',
        patient: patient.patientName,
        patientId: patient.patientId,
        issue: risk.title,
        action: risk.actionRequired,
      });
    }
  }
  
  // Add segment-level action items
  for (const segment of report.segmentAnalysis) {
    for (const finding of segment.findings.filter(f => f.level === RISK_LEVEL.HIGH)) {
      report.actionItems.push({
        priority: 'HIGH',
        segment: segment.segmentName,
        issue: finding.title,
        action: finding.recommendation,
      });
    }
  }
  
  return report;
}

/**
 * Get risk dashboard summary
 */
async function getRiskDashboard() {
  const db = getDatabase();
  
  const patients = db.prepare('SELECT * FROM patients WHERE waitlist_status = ?').all('active');
  
  const now = new Date();
  
  // Quick metrics
  const metrics = {
    evaluationsExpiringSoon: 0,
    staleDocumentation: 0,
    incompleteRecords: 0,
    highChurnPatients: 0,
  };
  
  const atRiskPatients = [];
  
  for (const patient of patients) {
    const risks = [];
    
    // Check evaluation expiry
    if (patient.last_evaluation_date) {
      const evalDate = new Date(patient.last_evaluation_date);
      const daysSince = Math.floor((now - evalDate) / (1000 * 60 * 60 * 24));
      if ((365 - daysSince) <= 30) {
        metrics.evaluationsExpiringSoon++;
        risks.push('Evaluation expiring');
      }
    }
    
    // Check documentation staleness
    if (patient.updated_date) {
      const updateDate = new Date(patient.updated_date);
      const daysSince = Math.floor((now - updateDate) / (1000 * 60 * 60 * 24));
      if (daysSince > 60) {
        metrics.staleDocumentation++;
        risks.push('Stale documentation');
      }
    }
    
    // Check incomplete records
    if (!patient.blood_type || !patient.hla_typing || !patient.medical_urgency) {
      metrics.incompleteRecords++;
      risks.push('Incomplete data');
    }
    
    if (risks.length > 0) {
      atRiskPatients.push({
        id: patient.id,
        name: `${patient.first_name} ${patient.last_name}`,
        mrn: patient.patient_id,
        risks,
        riskCount: risks.length,
      });
    }
  }
  
  // Sort by risk count
  atRiskPatients.sort((a, b) => b.riskCount - a.riskCount);
  
  return {
    metrics,
    totalActive: patients.length,
    atRiskCount: atRiskPatients.length,
    atRiskPercentage: ((atRiskPatients.length / patients.length) * 100).toFixed(1),
    topAtRiskPatients: atRiskPatients.slice(0, 10),
    generatedAt: now.toISOString(),
  };
}

module.exports = {
  RISK_THRESHOLDS,
  RISK_LEVEL,
  assessPatientOperationalRisk,
  analyzeWaitlistSegment,
  generateOperationalRiskReport,
  getRiskDashboard,
};

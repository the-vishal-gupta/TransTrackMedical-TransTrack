/**
 * TransTrack - Offline Degradation and Reconciliation
 * 
 * Handles offline operation scenarios and data reconciliation
 * when connectivity is restored or systems are merged.
 */

const { getDatabase } = require('../database/init.cjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Offline operation modes
const OPERATION_MODE = {
  NORMAL: 'normal',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
  RECOVERY: 'recovery',
};

// Conflict resolution strategies
const CONFLICT_STRATEGY = {
  LATEST_WINS: 'latest_wins',
  MANUAL_REVIEW: 'manual_review',
  SOURCE_PRIORITY: 'source_priority',
};

let currentMode = OPERATION_MODE.NORMAL;
let pendingChanges = [];

/**
 * Get pending changes file path
 */
function getPendingChangesPath() {
  return path.join(app.getPath('userData'), 'pending-changes.json');
}

/**
 * Set operation mode
 */
function setOperationMode(mode) {
  const previousMode = currentMode;
  currentMode = mode;
  
  const db = getDatabase();
  db.prepare(`
    INSERT INTO audit_logs (id, action, entity_type, details, user_email, user_role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'mode_change',
    'System',
    `Operation mode changed: ${previousMode} -> ${mode}`,
    'system',
    'system'
  );
  
  return { previousMode, currentMode: mode };
}

/**
 * Get current operation mode
 */
function getOperationMode() {
  return currentMode;
}

/**
 * Queue change for later reconciliation
 */
function queueChangeForReconciliation(change) {
  const queuedChange = {
    id: uuidv4(),
    ...change,
    queuedAt: new Date().toISOString(),
    status: 'pending',
  };
  
  pendingChanges.push(queuedChange);
  savePendingChanges();
  
  return queuedChange;
}

/**
 * Save pending changes to disk
 */
function savePendingChanges() {
  const filePath = getPendingChangesPath();
  fs.writeFileSync(filePath, JSON.stringify(pendingChanges, null, 2));
}

/**
 * Load pending changes from disk
 */
function loadPendingChanges() {
  const filePath = getPendingChangesPath();
  if (fs.existsSync(filePath)) {
    try {
      pendingChanges = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      pendingChanges = [];
    }
  }
  return pendingChanges;
}

/**
 * Get pending changes count
 */
function getPendingChangesCount() {
  return pendingChanges.filter(c => c.status === 'pending').length;
}

/**
 * Get all pending changes
 */
function getPendingChanges() {
  return pendingChanges;
}

/**
 * Detect conflicts between two records
 */
function detectConflicts(localRecord, remoteRecord) {
  const conflicts = [];
  
  // Compare each field
  const allKeys = new Set([...Object.keys(localRecord), ...Object.keys(remoteRecord)]);
  
  for (const key of allKeys) {
    if (key === 'id' || key === 'created_date') continue;
    
    const localValue = localRecord[key];
    const remoteValue = remoteRecord[key];
    
    if (JSON.stringify(localValue) !== JSON.stringify(remoteValue)) {
      conflicts.push({
        field: key,
        localValue,
        remoteValue,
        localUpdated: localRecord.updated_date,
        remoteUpdated: remoteRecord.updated_date,
      });
    }
  }
  
  return conflicts;
}

/**
 * Resolve conflicts using specified strategy
 */
function resolveConflicts(conflicts, strategy, localRecord, remoteRecord) {
  const resolved = { ...localRecord };
  const resolutionLog = [];
  
  for (const conflict of conflicts) {
    let resolvedValue;
    let resolution;
    
    switch (strategy) {
      case CONFLICT_STRATEGY.LATEST_WINS:
        const localTime = new Date(conflict.localUpdated || 0);
        const remoteTime = new Date(conflict.remoteUpdated || 0);
        
        if (remoteTime > localTime) {
          resolvedValue = conflict.remoteValue;
          resolution = 'remote_newer';
        } else {
          resolvedValue = conflict.localValue;
          resolution = 'local_newer';
        }
        break;
        
      case CONFLICT_STRATEGY.SOURCE_PRIORITY:
        // Local (source) takes priority
        resolvedValue = conflict.localValue;
        resolution = 'source_priority';
        break;
        
      case CONFLICT_STRATEGY.MANUAL_REVIEW:
      default:
        // Keep local but flag for review
        resolvedValue = conflict.localValue;
        resolution = 'pending_review';
        break;
    }
    
    resolved[conflict.field] = resolvedValue;
    resolutionLog.push({
      field: conflict.field,
      resolution,
      chosenValue: resolvedValue,
    });
  }
  
  return { resolved, resolutionLog };
}

/**
 * Reconcile pending changes
 */
async function reconcilePendingChanges(strategy = CONFLICT_STRATEGY.LATEST_WINS) {
  const db = getDatabase();
  const pending = pendingChanges.filter(c => c.status === 'pending');
  
  const results = {
    processed: 0,
    succeeded: 0,
    conflicts: 0,
    failed: 0,
    details: [],
  };
  
  for (const change of pending) {
    try {
      results.processed++;
      
      // Apply the change based on type
      switch (change.type) {
        case 'create':
          db.prepare(`INSERT OR IGNORE INTO ${change.table} (id) VALUES (?)`).run(change.data.id);
          // Update with full data
          const createFields = Object.keys(change.data).filter(k => k !== 'id');
          const createUpdates = createFields.map(k => `${k} = ?`).join(', ');
          db.prepare(`UPDATE ${change.table} SET ${createUpdates} WHERE id = ?`)
            .run(...createFields.map(k => change.data[k]), change.data.id);
          break;
          
        case 'update':
          const updateFields = Object.keys(change.data).filter(k => k !== 'id');
          const updates = updateFields.map(k => `${k} = ?`).join(', ');
          db.prepare(`UPDATE ${change.table} SET ${updates} WHERE id = ?`)
            .run(...updateFields.map(k => change.data[k]), change.entityId);
          break;
          
        case 'delete':
          db.prepare(`DELETE FROM ${change.table} WHERE id = ?`).run(change.entityId);
          break;
      }
      
      change.status = 'reconciled';
      change.reconciledAt = new Date().toISOString();
      results.succeeded++;
      
      results.details.push({
        changeId: change.id,
        status: 'success',
        type: change.type,
        table: change.table,
      });
      
    } catch (error) {
      change.status = 'failed';
      change.error = error.message;
      results.failed++;
      
      results.details.push({
        changeId: change.id,
        status: 'failed',
        error: error.message,
      });
    }
  }
  
  savePendingChanges();
  
  // Log reconciliation
  db.prepare(`
    INSERT INTO audit_logs (id, action, entity_type, details, user_email, user_role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'reconciliation',
    'System',
    `Reconciliation completed: ${results.succeeded} succeeded, ${results.failed} failed`,
    'system',
    'system'
  );
  
  return results;
}

/**
 * Import external data with reconciliation
 */
async function importWithReconciliation(importData, options = {}) {
  const db = getDatabase();
  const strategy = options.strategy || CONFLICT_STRATEGY.LATEST_WINS;
  
  const results = {
    imported: 0,
    updated: 0,
    conflicts: [],
    skipped: 0,
  };
  
  for (const [table, records] of Object.entries(importData.tables || {})) {
    for (const record of records) {
      // Check if record exists
      const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(record.id);
      
      if (existing) {
        // Detect conflicts
        const conflicts = detectConflicts(existing, record);
        
        if (conflicts.length > 0) {
          if (strategy === CONFLICT_STRATEGY.MANUAL_REVIEW) {
            results.conflicts.push({
              table,
              recordId: record.id,
              conflicts,
            });
            results.skipped++;
            continue;
          }
          
          const { resolved } = resolveConflicts(conflicts, strategy, existing, record);
          
          // Update with resolved data
          const fields = Object.keys(resolved).filter(k => k !== 'id');
          const updates = fields.map(k => `${k} = ?`).join(', ');
          db.prepare(`UPDATE ${table} SET ${updates} WHERE id = ?`)
            .run(...fields.map(k => resolved[k]), record.id);
          
          results.updated++;
        }
      } else {
        // Insert new record
        const fields = Object.keys(record);
        const placeholders = fields.map(() => '?').join(', ');
        db.prepare(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`)
          .run(...fields.map(k => record[k]));
        
        results.imported++;
      }
    }
  }
  
  return results;
}

/**
 * Get reconciliation status
 */
function getReconciliationStatus() {
  const pending = loadPendingChanges();
  
  return {
    operationMode: currentMode,
    pendingChanges: pending.filter(c => c.status === 'pending').length,
    reconciledChanges: pending.filter(c => c.status === 'reconciled').length,
    failedChanges: pending.filter(c => c.status === 'failed').length,
    lastReconciliation: pending.find(c => c.reconciledAt)?.reconciledAt || null,
  };
}

/**
 * Clear reconciled changes
 */
function clearReconciledChanges() {
  pendingChanges = pendingChanges.filter(c => c.status !== 'reconciled');
  savePendingChanges();
  return pendingChanges.length;
}

module.exports = {
  OPERATION_MODE,
  CONFLICT_STRATEGY,
  setOperationMode,
  getOperationMode,
  queueChangeForReconciliation,
  getPendingChangesCount,
  getPendingChanges,
  loadPendingChanges,
  detectConflicts,
  resolveConflicts,
  reconcilePendingChanges,
  importWithReconciliation,
  getReconciliationStatus,
  clearReconciledChanges,
};

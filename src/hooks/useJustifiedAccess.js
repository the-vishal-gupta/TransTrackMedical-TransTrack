import { useState, useCallback } from 'react';

/**
 * Hook for handling access with justification requirements
 * 
 * Usage:
 * const { requireJustification, JustificationDialog } = useJustifiedAccess();
 * 
 * const handleSensitiveAction = async () => {
 *   const result = await requireJustification('patient:view_phi', 'Patient', patientId);
 *   if (result.authorized) {
 *     // Proceed with action
 *   }
 * };
 */
export function useJustifiedAccess() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const requireJustification = useCallback((permission, entityType, entityId) => {
    return new Promise((resolve) => {
      setPendingAction({
        permission,
        entityType,
        entityId,
        resolve,
      });
      setDialogOpen(true);
    });
  }, []);

  const handleConfirm = useCallback((justification) => {
    if (pendingAction) {
      pendingAction.resolve({
        authorized: true,
        justification,
      });
      setPendingAction(null);
    }
    setDialogOpen(false);
  }, [pendingAction]);

  const handleCancel = useCallback(() => {
    if (pendingAction) {
      pendingAction.resolve({
        authorized: false,
        cancelled: true,
      });
      setPendingAction(null);
    }
    setDialogOpen(false);
  }, [pendingAction]);

  return {
    requireJustification,
    dialogOpen,
    setDialogOpen,
    pendingAction,
    handleConfirm,
    handleCancel,
  };
}

export default useJustifiedAccess;

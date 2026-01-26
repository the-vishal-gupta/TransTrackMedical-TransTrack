import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Shield, AlertTriangle } from 'lucide-react';

export default function JustificationDialog({ 
  open, 
  onOpenChange, 
  permission,
  entityType,
  entityId,
  onConfirm,
  onCancel 
}) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [justificationReasons, setJustificationReasons] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadReasons();
  }, []);

  const loadReasons = async () => {
    if (window.electronAPI?.accessControl) {
      try {
        const reasons = await window.electronAPI.accessControl.getJustificationReasons();
        setJustificationReasons(reasons);
      } catch (e) {
        // Default reasons if API fails
        setJustificationReasons([
          { id: 'treatment', label: 'Direct patient treatment' },
          { id: 'care_coordination', label: 'Care coordination' },
          { id: 'quality_review', label: 'Quality assurance review' },
          { id: 'audit_request', label: 'Audit or compliance request' },
          { id: 'emergency', label: 'Emergency access' },
          { id: 'other', label: 'Other (specify)' },
        ]);
      }
    }
  };

  const handleConfirm = async () => {
    if (!reason) return;
    if (reason === 'other' && !details.trim()) return;

    setIsLoading(true);
    try {
      // Log the justified access
      if (window.electronAPI?.accessControl) {
        await window.electronAPI.accessControl.logJustifiedAccess(
          permission,
          entityType,
          entityId,
          { reason, details }
        );
      }
      
      onConfirm({ reason, details });
    } catch (e) {
      console.error('Failed to log access:', e);
    } finally {
      setIsLoading(false);
      setReason('');
      setDetails('');
    }
  };

  const handleCancel = () => {
    setReason('');
    setDetails('');
    onCancel?.();
    onOpenChange(false);
  };

  const getPermissionLabel = (perm) => {
    const labels = {
      'patient:view_phi': 'View Protected Health Information',
      'patient:delete': 'Delete Patient Record',
      'donor:delete': 'Delete Donor Record',
      'match:approve': 'Approve Transplant Match',
      'audit:export': 'Export Audit Logs',
      'report:export': 'Export Reports',
      'system:restore': 'Restore System Backup',
    };
    return labels[perm] || perm;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-cyan-600" />
            Access Justification Required
          </DialogTitle>
          <DialogDescription>
            This action requires documented justification for compliance purposes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-sm text-amber-700">
              Action: <strong>{getPermissionLabel(permission)}</strong>
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason for Access</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                {justificationReasons.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(reason === 'other' || details) && (
            <div className="space-y-2">
              <Label htmlFor="details">
                Additional Details {reason === 'other' && <span className="text-red-500">*</span>}
              </Label>
              <Textarea
                id="details"
                placeholder="Please provide additional context..."
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
              />
            </div>
          )}

          <p className="text-xs text-slate-500">
            This access will be logged in the audit trail with your justification.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm}
            disabled={!reason || (reason === 'other' && !details.trim()) || isLoading}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            {isLoading ? 'Logging...' : 'Confirm Access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

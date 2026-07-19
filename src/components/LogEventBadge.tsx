import React from "react";
import { Badge } from "@/components/ui/badge";

interface LogEventBadgeProps {
  eventType: string;
}

const EVENT_BADGE_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  LOGIN_SUCCESS:          { bg: '#dcfce7', text: '#166534', border: '#86efac', label: 'Login Success' },
  LOGIN_FAILED:           { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5', label: 'Login Failed' },
  LOGOUT:                 { bg: '#f3f4f6', text: '#374151', border: '#d1d5db', label: 'Logout' },
  USER_REGISTERED:        { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd', label: 'User Registered' },
  PROFILE_PROVISIONING_FAILED: { bg: '#fef2f2', text: '#991b1b', border: '#fecaca', label: 'Profile Provisioning Failed' },
  STAFF_CREATED:          { bg: '#f3e8ff', text: '#6b21a8', border: '#e9d5ff', label: 'Staff Created' },
  STAFF_UPDATED:          { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe', label: 'Staff Updated' },
  STAFF_ACTIVATED:        { bg: '#dcfce7', text: '#166534', border: '#86efac', label: 'Staff Activated' },
  STAFF_DEACTIVATED:      { bg: '#fecaca', text: '#7f1d1d', border: '#f87171', label: 'Staff Deactivated' },
  DOCUMENT_APPROVED:      { bg: '#ccfbf1', text: '#134e4a', border: '#5eead4', label: 'Doc Approved' },
  DOCUMENT_REJECTED:      { bg: '#ffedd5', text: '#c2410c', border: '#fed7aa', label: 'Doc Rejected' },
  TRIAGE_COMPLETED:       { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe', label: 'Triage Completed' },
  RECORD_ENTERED:         { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd', label: 'Record Entered' },
  RAG_DOCUMENT_UPLOADED:  { bg: '#fae8ff', text: '#86198f', border: '#f5d0fe', label: 'RAG Uploaded' },
  RAG_DOCUMENT_DELETED:   { bg: '#fdf2f8', text: '#9d174d', border: '#fbcfe8', label: 'RAG Deleted' },
  ACCESS_DENIED:          { bg: '#450a0a', text: '#fecaca', border: '#7f1d1d', label: 'Access Denied' },
  EXPORT_SYSTEM_LOGS:     { bg: '#f0f9ff', text: '#0c4a6e', border: '#7dd3fc', label: 'Logs Exported' },
  STAFF_ACTION_FAILED:    { bg: '#fef2f2', text: '#991b1b', border: '#fee2e2', label: 'Staff Action Failed' },
  DOCUMENT_SUBMITTED:     { bg: '#ccfbf1', text: '#134e4a', border: '#5eead4', label: 'Doc Submitted' },
  DOCUMENT_OCR_PROCESSED: { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd', label: 'Document OCR Processed' },
  LAB_RESULT_OCR_PROCESSED: { bg: '#ecfeff', text: '#155e75', border: '#67e8f9', label: 'Lab Result OCR Processed' },
  DEPARTMENT_TEXT_OCR_PROCESSED: { bg: '#f0fdfa', text: '#115e59', border: '#5eead4', label: 'Department Text OCR Processed' },
  PRIVACY_ACCEPTED:       { bg: '#dcfce7', text: '#166534', border: '#86efac', label: 'Privacy Accepted' },
  QUEUE_COMPLETED:        { bg: '#dcfce7', text: '#166534', border: '#86efac', label: 'Queue Completed' },
  MFA_ENROLLED:           { bg: '#dcfce7', text: '#166534', border: '#86efac', label: 'MFA Enrolled' },
  PASSWORD_CHANGED:       { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe', label: 'Password Changed' },
  PROFILE_UPDATED:        { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd', label: 'Profile Updated' },
  SPECIALIST_PATIENT_CREATED: { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd', label: 'Spec Patient Created' },
  SPECIALIST_RECORD_ENTERED: { bg: '#fae8ff', text: '#86198f', border: '#f5d0fe', label: 'Spec Record Entered' },
  CUSTOM_ROLE_CREATED:    { bg: '#ecfeff', text: '#155e75', border: '#67e8f9', label: 'Role Created' },
  ROLE_UPDATED:           { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', label: 'Role Updated' },
  ROLE_DELETED:           { bg: '#fef2f2', text: '#991b1b', border: '#fecaca', label: 'Role Deleted' },
  ROLE_ASSIGNED:          { bg: '#f3e8ff', text: '#6b21a8', border: '#e9d5ff', label: 'Role Assigned' },
};

const DEFAULT_BADGE_STYLE = { bg: '#f3f4f6', text: '#374151', border: '#d1d5db', label: 'Unknown Event' };

export default function LogEventBadge({ eventType }: LogEventBadgeProps) {
  const style = EVENT_BADGE_STYLES[eventType] || {
    ...DEFAULT_BADGE_STYLE,
    label: eventType.replace(/_/g, " "),
  };

  return (
    <Badge
      variant="outline"
      style={{
        backgroundColor: style.bg,
        color: style.text,
        borderColor: style.border,
      }}
      className="font-medium text-xs px-2 py-0.5 whitespace-nowrap"
    >
      {style.label}
    </Badge>
  );
}

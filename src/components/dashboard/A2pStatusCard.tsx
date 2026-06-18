'use client';

import { Building2, Link2, MessageSquare, Send } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { glassCard, orangeAccentIcon, textPrimary, textSecondary } from '@/lib/glass';
import { formatDate } from '@/lib/utils';
import type {
  CampaignAssignmentStatus,
  RegistrationStatus,
  SmsBlockReason,
} from '@/types/database';

export interface A2pStatusCardProps {
  brandStatus: RegistrationStatus | null;
  brandStatusUpdatedAt: string | null;
  brandRejectionReason: string | null;
  campaignStatus: RegistrationStatus | null;
  campaignStatusUpdatedAt: string | null;
  campaignRejectionReason: string | null;
  assignmentStatus: CampaignAssignmentStatus | null;
  assignmentFailureReason: string | null;
  smsReady: boolean;
  smsBlockReason: SmsBlockReason | null;
}

const SUPPORT_MAILTO_BRAND =
  'mailto:support@simplassist.com?subject=Brand%20registration%20update%20needed';
const SUPPORT_MAILTO_CAMPAIGN =
  'mailto:support@simplassist.com?subject=SMS%20campaign%20update%20needed';

function StatusBadge({ status }: { status: RegistrationStatus | null }) {
  if (status === 'approved') return <Badge variant="success">Approved</Badge>;
  if (status === 'rejected') return <Badge variant="error">Needs update</Badge>;
  if (status === 'pending') return <Badge variant="warning">Under carrier review</Badge>;
  return <Badge variant="default">Not submitted</Badge>;
}

function AssignmentBadge({
  status,
}: {
  status: CampaignAssignmentStatus | null;
}) {
  if (status === 'assigned') return <Badge variant="success">Assigned</Badge>;
  if (status === 'pending') return <Badge variant="warning">Linking</Badge>;
  if (status === 'failed') return <Badge variant="error">Needs attention</Badge>;
  return <Badge variant="default">Not assigned</Badge>;
}

function RejectionBanner({
  reason,
  mailto,
}: {
  reason: string | null;
  mailto: string;
}) {
  return (
    <div className="mt-3 ml-11 rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/20 dark:bg-[rgba(239,68,68,.08)]">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">
        Your registration needs an update before it can be approved.
      </p>
      {reason && (
        <p className="mt-1 text-xs text-red-600/90 dark:text-red-400/80">{reason}</p>
      )}
      <a
        href={mailto}
        className="mt-2 inline-block text-xs font-semibold text-red-700 underline decoration-red-300 underline-offset-2 hover:decoration-red-500 dark:text-red-400 dark:decoration-red-500/40"
      >
        Contact support
      </a>
    </div>
  );
}

function StatusRow({
  icon: Icon,
  title,
  status,
  updatedAt,
  rejectionReason,
  rejectionMailto,
}: {
  icon: typeof Building2;
  title: string;
  status: RegistrationStatus | null;
  updatedAt: string | null;
  rejectionReason: string | null;
  rejectionMailto: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className={`p-2 shrink-0 ${orangeAccentIcon}`}>
          <Icon className="w-5 h-5 text-[#ff914d]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${textPrimary}`}>{title}</p>
          {updatedAt && (
            <p className={`text-xs ${textSecondary}`}>
              Updated {formatDate(updatedAt, 'PP')}
            </p>
          )}
        </div>
        <StatusBadge status={status} />
      </div>
      {status === 'rejected' && (
        <RejectionBanner reason={rejectionReason} mailto={rejectionMailto} />
      )}
    </div>
  );
}

function AssignmentRow({
  status,
  failureReason,
}: {
  status: CampaignAssignmentStatus | null;
  failureReason: string | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className={`p-2 shrink-0 ${orangeAccentIcon}`}>
          <Link2 className="w-5 h-5 text-[#ff914d]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${textPrimary}`}>Phone number assignment</p>
          <p className={`text-xs ${textSecondary}`}>
            Your Telnyx number must be linked to the approved SMS campaign.
          </p>
        </div>
        <AssignmentBadge status={status} />
      </div>
      {status === 'failed' && (
        <RejectionBanner reason={failureReason} mailto={SUPPORT_MAILTO_CAMPAIGN} />
      )}
    </div>
  );
}

function smsReadyCopy(reason: SmsBlockReason | null): string {
  switch (reason) {
    case 'campaign_not_approved':
      return 'Available once your campaign is approved.';
    case 'assignment_pending':
      return 'Campaign approved. Waiting for Telnyx to finish phone number assignment.';
    case 'assignment_failed':
      return 'Campaign approved, but phone number assignment needs attention.';
    case 'missing_phone_number':
      return 'Available once your business has an active phone number.';
    case 'missing_messaging_profile':
      return 'Messaging profile setup is incomplete.';
    default:
      return 'Your AI assistant can send and reply to customers.';
  }
}

function SmsLiveRow({
  smsReady,
  blockReason,
}: {
  smsReady: boolean;
  blockReason: SmsBlockReason | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`p-2 shrink-0 ${orangeAccentIcon}`}>
        <Send className="w-5 h-5 text-[#ff914d]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${textPrimary}`}>SMS sending</p>
        <p className={`text-xs ${textSecondary}`}>
          {smsReady ? smsReadyCopy(null) : smsReadyCopy(blockReason)}
        </p>
      </div>
      {smsReady ? (
        <Badge variant="success">Active</Badge>
      ) : (
        <Badge variant="default">Paused</Badge>
      )}
    </div>
  );
}

export default function A2pStatusCard({
  brandStatus,
  brandStatusUpdatedAt,
  brandRejectionReason,
  campaignStatus,
  campaignStatusUpdatedAt,
  campaignRejectionReason,
  assignmentStatus,
  assignmentFailureReason,
  smsReady,
  smsBlockReason,
}: A2pStatusCardProps) {
  // Visibility gate: only render once Phase 3 has fired (brand or campaign has any status).
  // Pre-onboarding businesses get no card.
  if (!brandStatus && !campaignStatus) return null;

  return (
    <div className={`p-5 ${glassCard}`}>
      <div className="mb-4">
        <p className={`text-sm font-semibold ${textPrimary}`}>
          SMS registration status
        </p>
        <p className={`text-xs ${textSecondary}`}>
          Carriers (AT&T, T-Mobile, Verizon) review every new business sending SMS. This usually takes 1–5 days.
        </p>
      </div>
      <div className="space-y-4">
        <StatusRow
          icon={Building2}
          title="Business registration"
          status={brandStatus}
          updatedAt={brandStatusUpdatedAt}
          rejectionReason={brandRejectionReason}
          rejectionMailto={SUPPORT_MAILTO_BRAND}
        />
        <StatusRow
          icon={MessageSquare}
          title="SMS campaign"
          status={campaignStatus}
          updatedAt={campaignStatusUpdatedAt}
          rejectionReason={campaignRejectionReason}
          rejectionMailto={SUPPORT_MAILTO_CAMPAIGN}
        />
        <AssignmentRow
          status={assignmentStatus}
          failureReason={assignmentFailureReason}
        />
        <SmsLiveRow smsReady={smsReady} blockReason={smsBlockReason} />
      </div>
    </div>
  );
}

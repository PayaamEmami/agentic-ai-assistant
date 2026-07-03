type BadgeVariant = 'neutral' | 'accent' | 'success' | 'error' | 'warning';

export function getToolStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'planned':
      return 'Planned by model';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Declined';
    case 'running':
      return 'Currently running';
    case 'pending':
      return 'Waiting for approval';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return 'Unknown';
  }
}

export function getToolStatusVariant(status: string | undefined): BadgeVariant {
  switch (status) {
    case 'planned':
      return 'accent';
    case 'approved':
      return 'success';
    case 'rejected':
      return 'error';
    case 'running':
      return 'warning';
    case 'pending':
      return 'neutral';
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    default:
      return 'neutral';
  }
}

export function getDisplayToolStatus(
  status: string | undefined,
  approvalStatus: string | undefined,
): string | undefined {
  if (
    approvalStatus &&
    (status === 'pending' || status === 'planned') &&
    approvalStatus !== 'expired'
  ) {
    return approvalStatus;
  }

  return status;
}

export function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

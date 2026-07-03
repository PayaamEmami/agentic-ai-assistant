import { request } from './client';

export const approvalsApi = {
  listPending() {
    return request<{
      approvals: Array<{
        id: string;
        toolExecutionId: string;
        description: string;
        status: string;
        createdAt: string;
      }>;
    }>('/api/approvals');
  },
  decide(id: string, status: 'approved' | 'rejected') {
    return request<{ ok: boolean }>(`/api/approvals/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },
};

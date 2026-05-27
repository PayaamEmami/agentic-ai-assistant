'use client';

import { useCallback, useState } from 'react';
import { api } from '../api-client';
import { parseApprovalStatus } from './model/index';
import type { ApprovalStatusByToolExecution, PendingApproval } from './types';

interface UseChatApprovalsOptions {
  setError: (message: string | null) => void;
}

export function useChatApprovals({ setError }: UseChatApprovalsOptions) {
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [approvalStatusesByToolExecution, setApprovalStatusesByToolExecution] =
    useState<ApprovalStatusByToolExecution>({});
  const [isLoadingApprovals, setIsLoadingApprovals] = useState(false);

  const loadPendingApprovals = useCallback(async () => {
    setIsLoadingApprovals(true);
    try {
      const response = await api.approvals.listPending();
      const approvals = response.approvals
        .map((item) => ({
          id: item.id,
          toolExecutionId: item.toolExecutionId,
          description: item.description,
          status: parseApprovalStatus(item.status),
          createdAt: item.createdAt ?? new Date().toISOString(),
        }))
        .filter((item) => item.status === 'pending');
      setPendingApprovals(approvals);
      setApprovalStatusesByToolExecution((previous) => {
        const next = { ...previous };

        for (const [toolExecutionId, status] of Object.entries(next)) {
          if (status === 'pending') {
            delete next[toolExecutionId];
          }
        }

        for (const approval of approvals) {
          next[approval.toolExecutionId] = approval.status;
        }

        return next;
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load approvals');
    } finally {
      setIsLoadingApprovals(false);
    }
  }, [setError]);

  const decideApproval = useCallback(
    async (approvalId: string, status: 'approved' | 'rejected') => {
      setError(null);
      try {
        const matchingApproval = pendingApprovals.find((item) => item.id === approvalId);
        await api.approvals.decide(approvalId, status);
        setPendingApprovals((previous) => previous.filter((item) => item.id !== approvalId));
        if (matchingApproval) {
          setApprovalStatusesByToolExecution((previous) => ({
            ...previous,
            [matchingApproval.toolExecutionId]: status,
          }));
        }
      } catch (requestError) {
        setError(
          requestError instanceof Error ? requestError.message : 'Failed to decide approval',
        );
        throw requestError;
      }
    },
    [pendingApprovals, setError],
  );

  const approveAction = useCallback(
    async (approvalId: string) => {
      await decideApproval(approvalId, 'approved');
    },
    [decideApproval],
  );

  const rejectAction = useCallback(
    async (approvalId: string) => {
      await decideApproval(approvalId, 'rejected');
    },
    [decideApproval],
  );

  const resolveApprovalStatus = useCallback(
    (toolExecutionId: string | undefined, status: 'approved' | 'rejected' | undefined) => {
      if (!toolExecutionId || !status) {
        return;
      }

      setApprovalStatusesByToolExecution((previous) => ({
        ...previous,
        [toolExecutionId]: status,
      }));
    },
    [],
  );

  return {
    pendingApprovals,
    approvalStatusesByToolExecution,
    isLoadingApprovals,
    loadPendingApprovals,
    approveAction,
    rejectAction,
    resolveApprovalStatus,
  };
}

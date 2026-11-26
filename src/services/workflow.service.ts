import { BaseApiService } from './api.service';

export interface WorkflowLog {
  time: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface PermitSignature {
  owner: `0x${string}`;
  spender: `0x${string}`;
  tokenAddress: `0x${string}`;
  chainId: number;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}


export type WorkflowRun = {
  id: string;
  status: 'running' | 'success' | 'error';
  startedAt: string;
  nodeResults: NodeRunResult[];
};

export type NodeRunResult = {
  nodeId: string;
  label: string;
  status: 'success' | 'error' | 'skipped';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
  startedAt: string;
  durationMs: number;
};

export type PendingApproval = {
   runId: string;
   approvalId: string;
   nodeId: string;
   expiresAt: string;
   summary: Record<string, unknown>;
};

export type PendingPayment = {
  runId: string;
  nodeId: string;
  itemCount: number;
  pricePerCall: number;
  totalAmount: number;
  token: string;
  tokenAddress: `0x${string}`;
  walletAddress: `0x${string}`;
  chainId: number;
};

export type RunEvent =
  | { type: "node_start";       nodeId: string; input: Record<string, unknown> }
  | { type: "node_success";     nodeId: string; output: Record<string, unknown> }
  | { type: "node_error";       nodeId: string; error: string }
  | { type: "log";              level: "info" | "error"; message: string }
  | { type: "complete";         status: "success" | "error"; nodeResults: NodeRunResult[] }
  | { type: "payment_required"; nodeId: string; itemCount: number; pricePerCall: number; totalAmount: number; token: string; tokenAddress: string; walletAddress: string; chainId: number }
  | { type: "approval_required"; approvalId: string; nodeId: string; expiresAt: string; summary: Record<string, unknown> }
  | { type: "approval_resolved"; approvalId: string; nodeId: string; decision: boolean }
  | { type: "stream_error" };

export interface WorkflowNode extends Record<string, unknown> {
   id: string;
   nodeId: string;
   type: "agent" | "trigger";
   position: { x: number; y: number };
   action: { key: string; label: string; endpoint?: string; x402?: boolean };
   label: string;
   image_url: string | null;
   config: Record<string, unknown>;
}

export interface WorkflowEdge {
   id: string;
   source: string;
   target: string;
}

export interface Workflow {
   id: string;
   name: string;
   description: string;
   published: boolean;
   runs: number;
   chat_id: string | null;
   canvas: {
      nodes: WorkflowNode[];
      edges: WorkflowEdge[];
   };
   viewport: { x: number; y: number; zoom: number };
   created_at: string;
   updated_at: string;
}

export interface WorkflowSchedule {
   id: string;
   workflow_id: string;
   name: string;
   cron: string;
   timezone: string;
   enabled: boolean;
   payload: Record<string, unknown>;
   max_attempts: number;
   interval_seconds: number | null;
   fee_stroops: number | null;
   end_at: string | null;
   max_runs: number;
   runs_count: number;
   period_seconds: number;
   period_cap_stroops: number;
   period_start: string | null;
   period_spent_stroops: number;
   funding_mode: 'allowance';
   allowance_cap_stroops: number;
   allowance_expires_at: string | null;
   contract_version: number;
   contract_job_id: number | null;
   commitment_hash: string | null;
   commitment_tx: string | null;
   last_error: string | null;
   last_run_at: string | null;
   next_run_at: string | null;
   created_at: string;
}

/** Step 1 of the "sign once" setup: the owner's allowance approval, plus the
 * exact job numbers needed to build the create transaction in step 3 once
 * that approval is confirmed on-chain. */
export interface ScheduleDraft {
   approvalXdr: string;
   approvalExpiresLedger: number;
   commitmentHash: string;
   nextRun: number;
   nextRunAt: string;
   intervalSeconds: number;
   feeStroops: string;
   endAt: number | null;
   maxRuns: number;
   periodSeconds: number;
   periodCapStroops: string;
   allowanceCapStroops: string;
   allowanceExpiresAt: number;
   contractId: string;
   networkPassphrase: string;
}

/** Step 3 result: the unsigned job-creation transaction. */
export interface ScheduleCreateTx {
   xdr: string;
   contractId: string;
   networkPassphrase: string;
}

export interface CreateScheduleInput {
   name?: string;
   cron: string;
   timezone?: string;
   payload?: Record<string, unknown>;
   maxAttempts?: number;
   ownerPublicKey: string;
   feeStroops?: string;
   endAt?: number;
   maxRuns?: number;
   periodSeconds?: number;
   periodCapStroops?: string;
   allowanceCapStroops?: string;
   allowanceExpiresAt?: number;
}

export type ScheduleAction = 'cancel' | 'pause' | 'resume' | 'set_limits';

export interface WorkflowTrigger {
   id: string;
   name: string;
   type: "webhook" | "event";
   token_hint: string;
   event_name: string | null;
   enabled: boolean;
   last_triggered_at: string | null;
   created_at: string;
}

export interface CreateWorkflowInput {
   name: string;
   description?: string;
   chat_id?: string;
}

export interface UpdateWorkflowInput {
   name?: string;
   description?: string;
   canvas?: Workflow["canvas"];
   viewport?: Workflow["viewport"];
}

class WorkflowService extends BaseApiService {
   async getAll(): Promise<Workflow[]> {
      try {
         const res = await this.api.get<{ workflows: Workflow[] }>('/workflows');
         return res.data.workflows;
      } catch (error) {
         throw this.handleError(error);
      }
   }

   async getById(id: string): Promise<Workflow> {
      try {
         const res = await this.api.get<{ workflow: Workflow }>(`/workflows/${id}`);
         return res.data.workflow;
      } catch (error) {
         throw this.handleError(error);
      }
   }

   async create(input: CreateWorkflowInput): Promise<Workflow> {
      try {
         const res = await this.api.post<{ workflow: Workflow }>('/workflows', input);
         return res.data.workflow;
      } catch (error) {
         throw this.handleError(error);
      }
   }

   async update(id: string, input: UpdateWorkflowInput): Promise<Workflow> {
      try {
         const res = await this.api.patch<{ workflow: Workflow }>(`/workflows/${id}`, input);
         return res.data.workflow;
      } catch (error) {
         throw this.handleError(error);
      }
   }

   async remove(id: string): Promise<void> {
      try {
         await this.api.delete(`/workflows/${id}`);
      } catch (error) {
         throw this.handleError(error);
      }
   }

   async run(id: string): Promise<{ runId: string }> {
      try {
         const res = await this.api.post<{ runId: string }>(`/workflows/${id}/run`, {});
         return res.data;
      } catch (error) {
         throw this.handleError(error);
      }
   }

   async stopRun(runId: string): Promise<void> {
      try {
         await this.api.post(`/runs/${runId}/stop`, {});
      } catch {
         // best-effort — run may have already finished
      }
   }

   async submitPayment(runId: string, permit: PermitSignature, nodeId: string): Promise<void> {
      try {
         await this.api.post(`/runs/${runId}/payment`, {
            nodeId,
            callIndex: 0,
            permit: {
               owner:    permit.owner,
               spender:  permit.spender,
               value:    permit.amount.toString(),
               nonce:    permit.nonce.toString(),
               deadline: permit.deadline.toString(),
               v: permit.v,
               r: permit.r,
               s: permit.s,
            },
         });
      } catch (error) {
         throw this.handleError(error);
      }
   }

   async decideApproval(runId: string, approvalId: string, decision: boolean): Promise<void> {
      try {
         await this.api.post(`/runs/${runId}/approvals/${approvalId}`, { decision });
      } catch (error) {
         throw this.handleError(error);
      }
   }

   async getSchedules(workflowId: string): Promise<WorkflowSchedule[]> {
      const res = await this.api.get<{ schedules: WorkflowSchedule[] }>(`/workflows/${workflowId}/schedules`);
      return res.data.schedules;
   }

   /** Step 1: build the allowance approval transaction. */
   async buildSchedule(workflowId: string, input: CreateScheduleInput): Promise<ScheduleDraft> {
      try {
         const res = await this.api.post<{ draft: ScheduleDraft }>(`/workflows/${workflowId}/schedules`, input);
         return res.data.draft;
      } catch (error) {
         throw this.handleError(error);
      }
   }

   /** Step 2: submit the signed allowance approval from step 1. */
   async submitAllowanceApproval(workflowId: string, xdr: string): Promise<{ txHash: string }> {
      try {
         const res = await this.api.post<{ txHash: string }>(
            `/workflows/${workflowId}/schedules/approve`,
            { xdr },
         );
         return res.data;
      } catch (error) {
         throw this.handleError(error);
      }
   }

   /** Step 3: now that the allowance is live, build the job-creation transaction. */
   async buildScheduleCreate(workflowId: string, input: {
      ownerPublicKey: string;
      commitmentHash: string;
      nextRun: number;
      intervalSeconds: number;
      feeStroops: string;
      endAt?: number;
      maxRuns?: number;
      periodSeconds?: number;
      periodCapStroops?: string;
      allowanceExpiresAt: number;
   }): Promise<ScheduleCreateTx> {
      try {
         const res = await this.api.post<ScheduleCreateTx>(
            `/workflows/${workflowId}/schedules/create`,
            input,
         );
         return res.data;
      } catch (error) {
         throw this.handleError(error);
      }
   }

   /** Step 4: submit the signed create transaction and persist the schedule. */
   async confirmSchedule(workflowId: string, input: {
      xdr: string;
      commitmentHash: string;
      ownerPublicKey: string;
      name: string;
      cron: string;
      timezone: string;
      payload: Record<string, unknown>;
      maxAttempts: number;
      endAt?: number;
      maxRuns?: number;
      periodSeconds?: number;
      periodCapStroops?: string;
      allowanceCapStroops?: string;
      allowanceExpiresAt?: number;
   }): Promise<WorkflowSchedule> {
      try {
         const res = await this.api.post<{ schedule: WorkflowSchedule }>(
            `/workflows/${workflowId}/schedules/confirm`,
            input,
         );
         return res.data.schedule;
      } catch (error) {
         throw this.handleError(error);
      }
   }

   async buildScheduleAction(workflowId: string, scheduleId: string, input: {
      action: ScheduleAction;
      ownerPublicKey: string;
      endAt?: number;
      maxRuns?: number;
      periodSeconds?: number;
      periodCapStroops?: string;
   }): Promise<string> {
      try {
         const res = await this.api.post<{ xdr: string }>(
            `/workflows/${workflowId}/schedules/${scheduleId}/action`,
            input,
         );
         return res.data.xdr;
      } catch (error) {
         throw this.handleError(error);
      }
   }

   async confirmScheduleAction(workflowId: string, scheduleId: string, input: {
      xdr: string;
      action: ScheduleAction;
      endAt?: number;
      maxRuns?: number;
      periodSeconds?: number;
      periodCapStroops?: string;
   }): Promise<{ schedule?: WorkflowSchedule; cancelled?: boolean; txHash: string }> {
      try {
         const res = await this.api.post<{ schedule?: WorkflowSchedule; cancelled?: boolean; txHash: string }>(
            `/workflows/${workflowId}/schedules/${scheduleId}/action/confirm`,
            input,
         );
         return res.data;
      } catch (error) {
         throw this.handleError(error);
      }
   }

   async getTriggers(workflowId: string): Promise<WorkflowTrigger[]> {
      const res = await this.api.get<{ triggers: WorkflowTrigger[] }>(`/workflows/${workflowId}/triggers`);
      return res.data.triggers;
   }

   async createTrigger(workflowId: string, input: {
      name?: string;
      type: "webhook" | "event";
      eventName?: string;
   }): Promise<{ trigger: WorkflowTrigger; token: string; webhookPath: string | null }> {
      const res = await this.api.post<{ trigger: WorkflowTrigger; token: string; webhookPath: string | null }>(
         `/workflows/${workflowId}/triggers`,
         input,
      );
      return res.data;
   }

   async deleteTrigger(workflowId: string, triggerId: string): Promise<void> {
      await this.api.delete(`/workflows/${workflowId}/triggers/${triggerId}`);
   }

   async getRuns(workflowId: string): Promise<WorkflowRun[]> {
      try {
         const res = await this.api.get<{ runs: WorkflowRun[] }>(`/workflows/${workflowId}/runs`);
         return res.data.runs;
      } catch {
         return [];
      }
   }

   stream(runId: string, onEvent: (event: RunEvent) => void): () => void {
      const base = (this.api.defaults.baseURL ?? "").replace(/\/$/, "");
      const es = new EventSource(`${base}/runs/${runId}/stream`, { withCredentials: true });

      es.onmessage = (e) => {
         try {
            const event = JSON.parse(e.data) as RunEvent;
            onEvent(event);
            if (event.type === "complete") es.close();
         } catch { /* ignore malformed events */ }
      };

      es.onerror = () => {
         onEvent({ type: "stream_error" });
         es.close();
      };

      // Return a cleanup function so the caller can close the stream early
      return () => es.close();
   }
}

export const workflowService = new WorkflowService();

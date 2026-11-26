import { useEffect, useState } from "react";
import { CalendarClock, Copy, ExternalLink, LogOut, Loader2, Pause, Play, Plus, Radio, Settings2, Trash2, Webhook } from "lucide-react";
import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { env } from "@/utils/env.utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
   workflowService,
   type WorkflowSchedule,
   type WorkflowTrigger,
} from "@/services/workflow.service";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; workflowId: string };

type PeriodUnit = "minute" | "hour" | "day" | "week";

const PERIOD_UNIT_SECONDS: Record<PeriodUnit, number> = {
   minute: 60,
   hour: 3_600,
   day: 86_400,
   week: 604_800,
};

// Stellar Wallets Kit replaces a hardcoded Freighter integration with a
// picker covering Freighter, Albedo, xBull, Lobstr, Rabet, Hana, and more —
// the owner chooses a wallet instead of being locked into one.
let walletsKitReady = false;
function ensureWalletsKit(): void {
   if (walletsKitReady) return;
   StellarWalletsKit.init({
      modules: defaultModules(),
      network: env.VITE_STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET,
   });
   walletsKitReady = true;
}

export function WorkflowAutomationModal({ open, onOpenChange, workflowId }: Props) {
   const [schedules, setSchedules] = useState<WorkflowSchedule[]>([]);
   const [triggers, setTriggers] = useState<WorkflowTrigger[]>([]);
   const [loading, setLoading] = useState(false);
   const [busy, setBusy] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [secret, setSecret] = useState<{ token: string; path: string | null } | null>(null);
   const [cron, setCron] = useState("0 9 * * *");
   const [timezone, setTimezone] = useState("UTC");
   const [triggerType, setTriggerType] = useState<"webhook" | "event">("webhook");
   const [eventName, setEventName] = useState("");
   const [feeXlm, setFeeXlm] = useState("0.01");
   const [periodCount, setPeriodCount] = useState("1");
   const [periodUnit, setPeriodUnit] = useState<PeriodUnit>("day");
   const [periodCapXlm, setPeriodCapXlm] = useState("");
   const [maxRuns, setMaxRuns] = useState("0");
   const [endAt, setEndAt] = useState("");
   const [allowanceCapXlm, setAllowanceCapXlm] = useState("1");
   const [allowanceDays, setAllowanceDays] = useState("30");
   const [editingId, setEditingId] = useState<string | null>(null);
   const [limitEndAt, setLimitEndAt] = useState("");
   const [limitMaxRuns, setLimitMaxRuns] = useState("0");
   const [limitPeriodCount, setLimitPeriodCount] = useState("0");
   const [limitPeriodUnit, setLimitPeriodUnit] = useState<PeriodUnit>("day");
   const [limitPeriodCapXlm, setLimitPeriodCapXlm] = useState("");
   const [walletAddress, setWalletAddress] = useState<string | null>(null);

   function networkPassphrase(): string {
      return env.VITE_STELLAR_NETWORK === "mainnet"
         ? env.VITE_STELLAR_MAINNET_PASSPHRASE
         : env.VITE_STELLAR_TESTNET_PASSPHRASE;
   }

   async function connectWallet(): Promise<string> {
      if (walletAddress) return walletAddress;
      ensureWalletsKit();
      const { address } = await StellarWalletsKit.authModal();
      if (!address) throw new Error("Connect a Stellar wallet first");
      setWalletAddress(address);
      return address;
   }

   function disconnectWallet(): void {
      setWalletAddress(null);
      void StellarWalletsKit.disconnect().catch(() => {
         // best-effort — some modules (e.g. Albedo) have nothing to disconnect
      });
   }

   async function signXdr(xdr: string, address: string): Promise<string> {
      const signed = await StellarWalletsKit.signTransaction(xdr, {
         address,
         networkPassphrase: networkPassphrase(),
      });
      if (signed.signerAddress && signed.signerAddress !== address) {
         throw new Error("The connected wallet signed with a different account. Reconnect and retry.");
      }
      return signed.signedTxXdr;
   }

   async function refresh() {
      setLoading(true);
      setError(null);
      try {
         const [nextSchedules, nextTriggers] = await Promise.all([
            workflowService.getSchedules(workflowId),
            workflowService.getTriggers(workflowId),
         ]);
         setSchedules(nextSchedules);
         setTriggers(nextTriggers);
      } catch (err) {
         setError(err instanceof Error ? err.message : "Could not load automation settings");
      } finally {
         setLoading(false);
      }
   }

   useEffect(() => {
      if (open) void refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [open, workflowId]);

   async function addSchedule() {
      setBusy(true);
      setError(null);
      try {
         const address = await connectWallet();
         const feeStroops = toStroops(feeXlm);
         const periodSeconds = toPeriodSeconds(periodCount, periodUnit);
         const periodCapStroops = toOptionalStroops(periodCapXlm);
         const maxRunsValue = toNonNegativeInt(maxRuns, "Max runs");
         const endAtValue = dateTimeToEpoch(endAt);
         const allowanceCapStroops = toStroops(allowanceCapXlm);
         const allowanceExpiresAt =
            Math.floor(Date.now() / 1000) + toNonNegativeInt(allowanceDays, "Allowance days") * 86_400;

         // Step 1: build the one-time allowance approval.
         const draft = await workflowService.buildSchedule(workflowId, {
            name: "Schedule",
            cron,
            timezone,
            ownerPublicKey: address,
            feeStroops,
            endAt: endAtValue,
            maxRuns: maxRunsValue,
            periodSeconds,
            periodCapStroops,
            allowanceCapStroops,
            allowanceExpiresAt,
            payload: {},
         });

         // Step 2: sign and submit that approval — this is the only wallet
         // prompt the owner will see for the lifetime of the schedule, aside
         // from the one below that actually creates the job.
         const signedApproval = await signXdr(draft.approvalXdr, address);
         await workflowService.submitAllowanceApproval(workflowId, signedApproval);

         // Step 3: now that the allowance is live on-chain, build the job.
         const createTx = await workflowService.buildScheduleCreate(workflowId, {
            ownerPublicKey: address,
            commitmentHash: draft.commitmentHash,
            nextRun: draft.nextRun,
            intervalSeconds: draft.intervalSeconds,
            feeStroops: draft.feeStroops,
            endAt: draft.endAt ?? undefined,
            maxRuns: draft.maxRuns,
            periodSeconds: draft.periodSeconds,
            periodCapStroops: draft.periodCapStroops,
            allowanceExpiresAt: draft.allowanceExpiresAt,
         });

         // Step 4: sign and submit the job creation, then persist it.
         const signedCreate = await signXdr(createTx.xdr, address);
         await workflowService.confirmSchedule(workflowId, {
            xdr: signedCreate,
            commitmentHash: draft.commitmentHash,
            ownerPublicKey: address,
            name: "Schedule",
            cron,
            timezone,
            payload: {},
            maxAttempts: 3,
            endAt: draft.endAt ?? undefined,
            maxRuns: draft.maxRuns,
            periodSeconds: draft.periodSeconds,
            periodCapStroops: draft.periodCapStroops,
            allowanceCapStroops: draft.allowanceCapStroops,
            allowanceExpiresAt: draft.allowanceExpiresAt,
         });
         await refresh();
      } catch (err) {
         setError(err instanceof Error ? err.message : "Could not create schedule");
      } finally {
         setBusy(false);
      }
   }

   async function toggleSchedule(schedule: WorkflowSchedule) {
      setBusy(true);
      setError(null);
      try {
         const address = await connectWallet();
         const action = schedule.enabled ? "pause" : "resume";
         const xdr = await workflowService.buildScheduleAction(workflowId, schedule.id, {
            action,
            ownerPublicKey: address,
         });
         const signedXdr = await signXdr(xdr, address);
         await workflowService.confirmScheduleAction(workflowId, schedule.id, { xdr: signedXdr, action });
         await refresh();
      } catch (err) {
         setError(err instanceof Error ? err.message : `Could not ${schedule.enabled ? "pause" : "resume"} schedule`);
      } finally {
         setBusy(false);
      }
   }

   async function addTrigger() {
      setBusy(true);
      setError(null);
      try {
         const created = await workflowService.createTrigger(workflowId, {
            type: triggerType,
            eventName: triggerType === "event" ? eventName.trim() : undefined,
            name: triggerType === "event" ? `Event: ${eventName.trim()}` : "Webhook",
         });
         if (triggerType === "webhook") setSecret({ token: created.token, path: created.webhookPath });
         setEventName("");
         await refresh();
      } catch (err) {
         setError(err instanceof Error ? err.message : "Could not create trigger");
      } finally {
         setBusy(false);
      }
   }

   function startEditing(schedule: WorkflowSchedule) {
      setEditingId(schedule.id);
      setLimitEndAt(toLocalDateTime(schedule.end_at));
      setLimitMaxRuns(String(schedule.max_runs));
      const period = splitPeriod(schedule.period_seconds);
      setLimitPeriodCount(String(period.count));
      setLimitPeriodUnit(period.unit);
      setLimitPeriodCapXlm(
         schedule.period_cap_stroops > 0 ? fromStroops(schedule.period_cap_stroops) : "",
      );
   }

   async function saveLimits(schedule: WorkflowSchedule) {
      setBusy(true);
      setError(null);
      try {
         const address = await connectWallet();
         const endAtValue = dateTimeToEpoch(limitEndAt);
         const maxRunsValue = toNonNegativeInt(limitMaxRuns, "Max runs");
         const periodSeconds = toPeriodSeconds(limitPeriodCount, limitPeriodUnit);
         const periodCapStroops = toOptionalStroops(limitPeriodCapXlm);
         const xdr = await workflowService.buildScheduleAction(workflowId, schedule.id, {
            action: "set_limits",
            ownerPublicKey: address,
            endAt: endAtValue,
            maxRuns: maxRunsValue,
            periodSeconds,
            periodCapStroops,
         });
         const signedXdr = await signXdr(xdr, address);
         await workflowService.confirmScheduleAction(workflowId, schedule.id, {
            xdr: signedXdr,
            action: "set_limits",
            endAt: endAtValue,
            maxRuns: maxRunsValue,
            periodSeconds,
            periodCapStroops,
         });
         setEditingId(null);
         await refresh();
      } catch (err) {
         setError(err instanceof Error ? err.message : "Could not update schedule limits");
      } finally {
         setBusy(false);
      }
   }

   async function removeSchedule(id: string) {
      setBusy(true);
      setError(null);
      try {
         const address = await connectWallet();
         const xdr = await workflowService.buildScheduleAction(workflowId, id, {
            action: "cancel",
            ownerPublicKey: address,
         });
         const signedXdr = await signXdr(xdr, address);
         await workflowService.confirmScheduleAction(workflowId, id, { xdr: signedXdr, action: "cancel" });
         await refresh();
      } catch (err) {
         setError(err instanceof Error ? err.message : "Could not cancel schedule");
      } finally {
         setBusy(false);
      }
   }

   async function removeTrigger(id: string) {
      setBusy(true);
      try {
         await workflowService.deleteTrigger(workflowId, id);
         await refresh();
      } catch (err) {
         setError(err instanceof Error ? err.message : "Could not delete trigger");
      } finally {
         setBusy(false);
      }
   }

   // modal=false: Radix otherwise sets body{pointer-events:none} while open,
   // which also disables the Stellar Wallets Kit's own popup since it's
   // injected outside Radix's tree and never gets pointer-events:auto back.
   return (
      <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
         <DialogContent
            aria-describedby={undefined}
            className="bg-[#141414] border border-white/10 p-0 gap-0 flex flex-col sm:max-w-[560px] max-h-[85vh] [&>button]:hidden overflow-hidden"
            onInteractOutside={(event) => {
               // modal=false means Radix treats the Stellar Wallets Kit's own
               // popup (injected outside this tree) as an "outside" click and
               // would otherwise close this dialog mid-connect/sign.
               event.preventDefault();
            }}
         >
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/8">
               <CalendarClock size={15} className="text-orange-300" />
               <DialogTitle className="text-[14px] font-semibold text-white font-manrope">Automation</DialogTitle>
            </div>

            <div className="overflow-y-auto px-5 py-4 flex flex-col gap-6">
               <p className="text-[12px] text-white/55 leading-relaxed">
                  Scheduled and triggered runs enforce the wallet's signed automation policy. Amounts above the approval
                  threshold wait for your approval before execution.
               </p>

               {walletAddress ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white/4 ring-1 ring-white/8 text-[11px]">
                     <span className="text-white/60 truncate">
                        Connected: <span className="text-white/85">{walletAddress.slice(0, 4)}…{walletAddress.slice(-4)}</span>
                     </span>
                     <button
                        onClick={disconnectWallet}
                        className="flex items-center gap-1 text-white/40 hover:text-white/80 cursor-pointer shrink-0"
                     >
                        <LogOut size={11} /> Disconnect
                     </button>
                  </div>
               ) : (
                  <p className="text-[11px] text-white/35 -mt-2">
                     No wallet connected yet — the first action below will open the wallet picker (Freighter, Albedo,
                     xBull, Lobstr, Rabet, Hana, and more).
                  </p>
               )}

               <section className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-white/85">
                     <CalendarClock size={13} />
                     <h3 className="text-[13px] font-semibold">Schedules</h3>
                  </div>
                  <div className="grid grid-cols-[1fr_120px_auto] gap-2">
                     <input
                        value={cron}
                        onChange={(e) => setCron(e.target.value)}
                        placeholder="0 9 * * *"
                        className="h-9 px-3 rounded-md bg-white/5 border border-white/10 text-[12px] text-white outline-none focus:border-white/30"
                     />
                     <input
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        placeholder="UTC"
                        className="h-9 px-3 rounded-md bg-white/5 border border-white/10 text-[12px] text-white outline-none focus:border-white/30"
                     />
                     <button
                        onClick={() => void addSchedule()}
                        disabled={busy || !cron.trim()}
                        className="h-9 px-3 rounded-md bg-white/10 text-[12px] text-white hover:bg-white/15 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                     >
                        <Plus size={13} /> Add
                     </button>
                  </div>
                  <p className="text-[11px] text-white/40 -mt-1">
                     Five-field cron in the selected IANA timezone. You sign one allowance approval — the keeper then
                     runs it with no further signatures until the allowance ends.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                     <label className="flex flex-col gap-1 text-[11px] text-white/45">
                        Fee per run (XLM)
                        <input
                           value={feeXlm}
                           onChange={(e) => setFeeXlm(e.target.value)}
                           inputMode="decimal"
                           className="h-9 px-3 rounded-md bg-white/5 border border-white/10 text-[12px] text-white outline-none focus:border-white/30"
                        />
                     </label>
                     <label className="flex flex-col gap-1 text-[11px] text-white/45">
                        Allowance cap (XLM)
                        <input
                           value={allowanceCapXlm}
                           onChange={(e) => setAllowanceCapXlm(e.target.value)}
                           inputMode="decimal"
                           className="h-9 px-3 rounded-md bg-white/5 border border-white/10 text-[12px] text-white outline-none focus:border-white/30"
                        />
                     </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                     <label className="flex flex-col gap-1 text-[11px] text-white/45">
                        Allowance expires (days)
                        <input
                           value={allowanceDays}
                           onChange={(e) => setAllowanceDays(e.target.value)}
                           inputMode="numeric"
                           placeholder="30"
                           className="h-9 px-3 rounded-md bg-white/5 border border-white/10 text-[12px] text-white outline-none focus:border-white/30"
                        />
                     </label>
                     <label className="flex flex-col gap-1 text-[11px] text-white/45">
                        Period cap (XLM, optional)
                        <input
                           value={periodCapXlm}
                           onChange={(e) => setPeriodCapXlm(e.target.value)}
                           inputMode="decimal"
                           placeholder="no cap"
                           className="h-9 px-3 rounded-md bg-white/5 border border-white/10 text-[12px] text-white outline-none focus:border-white/30"
                        />
                     </label>
                  </div>
                  <div className="grid grid-cols-[1fr_100px_1fr] gap-2">
                     <label className="flex flex-col gap-1 text-[11px] text-white/45">
                        Period length
                        <input
                           value={periodCount}
                           onChange={(e) => setPeriodCount(e.target.value)}
                           inputMode="numeric"
                           className="h-9 px-3 rounded-md bg-white/5 border border-white/10 text-[12px] text-white outline-none focus:border-white/30"
                        />
                     </label>
                     <label className="flex flex-col gap-1 text-[11px] text-white/45">
                        Unit
                        <select
                           value={periodUnit}
                           onChange={(e) => setPeriodUnit(e.target.value as PeriodUnit)}
                           className="h-9 px-2 rounded-md bg-white/5 border border-white/10 text-[12px] text-white outline-none focus:border-white/30"
                        >
                           {(["minute", "hour", "day", "week"] as PeriodUnit[]).map((unit) => (
                              <option key={unit} value={unit} className="bg-[#141414]">{unit}</option>
                           ))}
                        </select>
                     </label>
                     <label className="flex flex-col gap-1 text-[11px] text-white/45">
                        Max runs (0 = unlimited)
                        <input
                           value={maxRuns}
                           onChange={(e) => setMaxRuns(e.target.value)}
                           inputMode="numeric"
                           className="h-9 px-3 rounded-md bg-white/5 border border-white/10 text-[12px] text-white outline-none focus:border-white/30"
                        />
                     </label>
                  </div>
                  <label className="flex flex-col gap-1 text-[11px] text-white/45">
                     End date (optional)
                     <input
                        type="datetime-local"
                        value={endAt}
                        onChange={(e) => setEndAt(e.target.value)}
                        className="h-9 px-3 rounded-md bg-white/5 border border-white/10 text-[12px] text-white outline-none focus:border-white/30"
                     />
                  </label>

                  {schedules.length === 0 ? (
                     <p className="text-[12px] text-white/40">No schedules yet.</p>
                  ) : schedules.map((schedule) => (
                     <div key={schedule.id} className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-white/4 ring-1 ring-white/8">
                           <div className="min-w-0">
                              <p className="text-[12px] text-white font-medium truncate">{schedule.name || schedule.cron}</p>
                              <p className="text-[11px] text-white/40 truncate">
                                 {schedule.cron} · {schedule.timezone} · next {formatDate(schedule.next_run_at)}
                              </p>
                              <p className="text-[11px] text-white/35 truncate flex flex-wrap items-center gap-2">
                                 <span>{schedule.enabled ? "active" : "paused"}</span>
                                 {schedule.contract_job_id !== null && <span>job #{schedule.contract_job_id}</span>}
                                 {schedule.fee_stroops !== null && <span>{fromStroops(schedule.fee_stroops)} XLM/run</span>}
                                 {schedule.allowance_cap_stroops > 0 && (
                                    <span>allowance {fromStroops(schedule.allowance_cap_stroops)} XLM</span>
                                 )}
                                 {schedule.allowance_expires_at && (
                                    <span>allowance ends {formatDate(schedule.allowance_expires_at)}</span>
                                 )}
                                 {schedule.period_cap_stroops > 0 && (
                                    <span>{fromStroops(schedule.period_cap_stroops)} XLM / {formatPeriod(schedule.period_seconds)}</span>
                                 )}
                                 {schedule.max_runs > 0 && (
                                    <span>{schedule.runs_count}/{schedule.max_runs} runs</span>
                                 )}
                                 {schedule.end_at && <span>ends {formatDate(schedule.end_at)}</span>}
                                 {schedule.commitment_tx && (
                                    <a
                                       href={`https://stellar.expert/explorer/${env.VITE_STELLAR_NETWORK}/tx/${schedule.commitment_tx}`}
                                       target="_blank"
                                       rel="noreferrer"
                                       className="inline-flex items-center gap-1 text-white/45 hover:text-white/70"
                                    >
                                       tx <ExternalLink size={10} />
                                    </a>
                                 )}
                              </p>
                              {schedule.last_error && <p className="text-[11px] text-red-300/80 truncate">{schedule.last_error}</p>}
                           </div>
                           <div className="flex items-center gap-2">
                              <button
                                 onClick={() => (editingId === schedule.id ? setEditingId(null) : startEditing(schedule))}
                                 disabled={busy}
                                 title="Edit limits"
                                 className="text-white/40 hover:text-white/80 cursor-pointer disabled:opacity-40"
                              >
                                 <Settings2 size={14} />
                              </button>
                              <button onClick={() => void toggleSchedule(schedule)} disabled={busy} className="text-white/40 hover:text-white/80 cursor-pointer disabled:opacity-40">
                                 {schedule.enabled ? <Pause size={14} /> : <Play size={14} />}
                              </button>
                              <button onClick={() => void removeSchedule(schedule.id)} disabled={busy} className="text-white/40 hover:text-red-300 cursor-pointer disabled:opacity-40">
                                 <Trash2 size={14} />
                              </button>
                           </div>
                        </div>

                        {editingId === schedule.id && (
                           <div className="flex flex-col gap-2 px-3 py-2.5 bg-white/3 ring-1 ring-white/8">
                              <p className="text-[11px] text-white/50">Edit on-chain limits. Leave end date empty for no end.</p>
                              <div className="grid grid-cols-2 gap-2">
                                 <label className="flex flex-col gap-1 text-[11px] text-white/45">
                                    End date
                                    <input
                                       type="datetime-local"
                                       value={limitEndAt}
                                       onChange={(e) => setLimitEndAt(e.target.value)}
                                       className="h-8 px-2 rounded-md bg-white/5 border border-white/10 text-[11px] text-white outline-none focus:border-white/30"
                                    />
                                 </label>
                                 <label className="flex flex-col gap-1 text-[11px] text-white/45">
                                    Max runs (0 = unlimited)
                                    <input
                                       value={limitMaxRuns}
                                       onChange={(e) => setLimitMaxRuns(e.target.value)}
                                       inputMode="numeric"
                                       className="h-8 px-2 rounded-md bg-white/5 border border-white/10 text-[11px] text-white outline-none focus:border-white/30"
                                    />
                                 </label>
                              </div>
                              <div className="grid grid-cols-[1fr_100px_1fr] gap-2">
                                 <label className="flex flex-col gap-1 text-[11px] text-white/45">
                                    Period length
                                    <input
                                       value={limitPeriodCount}
                                       onChange={(e) => setLimitPeriodCount(e.target.value)}
                                       inputMode="numeric"
                                       className="h-8 px-2 rounded-md bg-white/5 border border-white/10 text-[11px] text-white outline-none focus:border-white/30"
                                    />
                                 </label>
                                 <label className="flex flex-col gap-1 text-[11px] text-white/45">
                                    Unit
                                    <select
                                       value={limitPeriodUnit}
                                       onChange={(e) => setLimitPeriodUnit(e.target.value as PeriodUnit)}
                                       className="h-8 px-2 rounded-md bg-white/5 border border-white/10 text-[11px] text-white outline-none focus:border-white/30"
                                    >
                                       {(["minute", "hour", "day", "week"] as PeriodUnit[]).map((unit) => (
                                          <option key={unit} value={unit} className="bg-[#141414]">{unit}</option>
                                       ))}
                                    </select>
                                 </label>
                                 <label className="flex flex-col gap-1 text-[11px] text-white/45">
                                    Period cap (XLM)
                                    <input
                                       value={limitPeriodCapXlm}
                                       onChange={(e) => setLimitPeriodCapXlm(e.target.value)}
                                       inputMode="decimal"
                                       placeholder="no cap"
                                       className="h-8 px-2 rounded-md bg-white/5 border border-white/10 text-[11px] text-white outline-none focus:border-white/30"
                                    />
                                 </label>
                              </div>
                              <div className="flex justify-end gap-2">
                                 <button
                                    onClick={() => setEditingId(null)}
                                    disabled={busy}
                                    className="h-8 px-3 rounded-md bg-white/5 text-[11px] text-white/70 hover:bg-white/10 cursor-pointer disabled:opacity-40"
                                 >
                                    Cancel
                                 </button>
                                 <button
                                    onClick={() => void saveLimits(schedule)}
                                    disabled={busy}
                                    className="h-8 px-3 rounded-md bg-white/10 text-[11px] text-white hover:bg-white/15 cursor-pointer disabled:opacity-40"
                                 >
                                    Save limits
                                 </button>
                              </div>
                           </div>
                        )}
                     </div>
                  ))}

               </section>

               <section className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-white/85">
                     <Webhook size={13} />
                     <h3 className="text-[13px] font-semibold">Triggers</h3>
                  </div>
                  <div className="grid grid-cols-[120px_1fr_auto] gap-2">
                     <select
                        value={triggerType}
                        onChange={(e) => setTriggerType(e.target.value as "webhook" | "event")}
                        className="h-9 px-2 rounded-md bg-white/5 border border-white/10 text-[12px] text-white outline-none focus:border-white/30"
                     >
                        <option value="webhook" className="bg-[#141414]">Webhook</option>
                        <option value="event" className="bg-[#141414]">Event</option>
                     </select>
                     <input
                        value={eventName}
                        onChange={(e) => setEventName(e.target.value)}
                        disabled={triggerType !== "event"}
                        placeholder={triggerType === "event" ? "event name" : "generated token"}
                        className="h-9 px-3 rounded-md bg-white/5 border border-white/10 text-[12px] text-white outline-none focus:border-white/30 disabled:opacity-40"
                     />
                     <button
                        onClick={() => void addTrigger()}
                        disabled={busy || (triggerType === "event" && !eventName.trim())}
                        className="h-9 px-3 rounded-md bg-white/10 text-[12px] text-white hover:bg-white/15 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                     >
                        <Plus size={13} /> Add
                     </button>
                  </div>

                  {secret && (
                     <div className="px-3 py-2.5 bg-amber-500/8 ring-1 ring-amber-400/20 text-[11px] text-amber-100/90 flex flex-col gap-2">
                        <p>Webhook token (shown once):</p>
                        <div className="flex items-center gap-2">
                           <code className="flex-1 break-all text-[11px] text-amber-50">{secret.token}</code>
                           <button
                              onClick={() => void navigator.clipboard.writeText(secret.token)}
                              className="p-1.5 rounded hover:bg-white/10 cursor-pointer"
                           >
                              <Copy size={12} />
                           </button>
                        </div>
                        {secret.path && <p className="text-amber-100/60">POST {secret.path}</p>}
                     </div>
                  )}

                  {triggers.length === 0 ? (
                     <p className="text-[12px] text-white/40">No triggers yet.</p>
                  ) : triggers.map((trigger) => (
                     <div key={trigger.id} className="flex items-center justify-between gap-3 px-3 py-2.5 bg-white/4 ring-1 ring-white/8">
                        <div className="min-w-0">
                           <p className="text-[12px] text-white font-medium truncate flex items-center gap-1.5">
                              {trigger.type === "event" ? <Radio size={11} /> : <Webhook size={11} />}
                              {trigger.name}
                           </p>
                           <p className="text-[11px] text-white/40 truncate">
                              {trigger.type === "event" ? trigger.event_name : `token ${trigger.token_hint}…`} · last {formatDate(trigger.last_triggered_at)}
                           </p>
                        </div>
                        <button onClick={() => void removeTrigger(trigger.id)} disabled={busy} className="text-white/40 hover:text-red-300 cursor-pointer disabled:opacity-40">
                           <Trash2 size={14} />
                        </button>
                     </div>
                  ))}
               </section>

               {loading && <div className="flex justify-center py-2"><Loader2 size={16} className="animate-spin text-white/40" /></div>}
               {error && <p className="text-[12px] text-red-300">{error}</p>}
            </div>
         </DialogContent>
      </Dialog>
   );
}

function toStroops(value: string): string {
   const trimmed = value.trim();
   if (!/^\d+(\.\d{0,7})?$/.test(trimmed)) {
      throw new Error("Enter an XLM amount with up to 7 decimals");
   }
   const [whole, fraction = ""] = trimmed.split(".");
   const stroops = BigInt(whole) * 10_000_000n + BigInt((fraction + "0000000").slice(0, 7));
   if (stroops <= 0n) throw new Error("Amount must be greater than zero");
   return stroops.toString();
}

function toOptionalStroops(value: string): string {
   const trimmed = value.trim();
   if (!trimmed) return "0";
   if (!/^\d+(\.\d{0,7})?$/.test(trimmed)) {
      throw new Error("Enter an XLM amount with up to 7 decimals");
   }
   const [whole, fraction = ""] = trimmed.split(".");
   return (BigInt(whole) * 10_000_000n + BigInt((fraction + "0000000").slice(0, 7))).toString();
}

function toNonNegativeInt(value: string, label: string): number {
   const trimmed = value.trim();
   if (!/^\d+$/.test(trimmed)) throw new Error(`${label} must be a non-negative integer`);
   return Number.parseInt(trimmed, 10);
}

function toPeriodSeconds(count: string, unit: PeriodUnit): number {
   return toNonNegativeInt(count, "Period length") * PERIOD_UNIT_SECONDS[unit];
}

function dateTimeToEpoch(value: string): number | undefined {
   if (!value.trim()) return undefined;
   const ms = new Date(value).getTime();
   if (Number.isNaN(ms)) throw new Error("Enter a valid end date");
   return Math.floor(ms / 1000);
}

function toLocalDateTime(value: string | null): string {
   if (!value) return "";
   const date = new Date(value);
   if (Number.isNaN(date.getTime())) return "";
   const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
   return local.toISOString().slice(0, 16);
}

function splitPeriod(seconds: number): { count: number; unit: PeriodUnit } {
   const units: PeriodUnit[] = ["week", "day", "hour", "minute"];
   for (const unit of units) {
      const size = PERIOD_UNIT_SECONDS[unit];
      if (seconds >= size && seconds % size === 0) {
         return { count: seconds / size, unit };
      }
   }
   return { count: 0, unit: "day" };
}

function formatPeriod(seconds: number): string {
   if (seconds <= 0) return "no period";
   const { count, unit } = splitPeriod(seconds);
   if (count === 0) return `${Math.round(seconds / 60)} min`;
   return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function fromStroops(value: number): string {
   return (value / 10_000_000).toFixed(2);
}

function formatDate(value: string | null): string {
   if (!value) return "never";
   const date = new Date(value);
   return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString();
}

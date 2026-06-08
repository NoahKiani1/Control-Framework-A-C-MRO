"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  addRepairAfterInspectionForOrder,
  canAddRepairAfterInspectionForOrder,
  getActualCompletedStepsForGroupedCompletion,
  getCompletedNdtChecklistForOrder,
  getGroupedCompletableStepsForOrder,
  getIncludedNdtStepsForOrder,
  getLastIncludedNdtStepForOrder,
  getNextProcessStepAfterNdtChecklistForOrder,
  getNextProcessStepAfterCompletedForOrder,
  getNextProcessStepAfterGroupedCompletedForOrder,
  getProcessStepDisplayName,
  normalizeCompletedNdtStepsForOrder,
  NDT_PROCESS_STEP,
  READY_TO_CLOSE_STEP,
} from "@/lib/process-steps";
import {
  applySuggestedAssignmentsForCurrentStep,
  autoAssignForStep,
  hasActiveRestrictionForStep,
} from "@/lib/auto-assign";
import {
  getAbsentEngineerIdSetForDateKey,
  getEngineerAbsences,
  getEngineers,
} from "@/lib/engineers";
import {
  DEFAULT_ASSIGNED_PERSON_TEAM,
  blockReason,
  formatDate,
  getCorrectiveActionCompletionPayload,
  getCorrectiveActionContext,
  hasActiveCorrectiveAction,
  isBlocked,
  isRfqManualApprovalBlocked,
  localDateKey as workOrderLocalDateKey,
  normalizeRfqState,
  normalizeAssignedPersonTeam,
  sortOrders,
  applyTodayQualificationBlocks,
} from "@/lib/work-order-rules";
import { getWorkOrders, updateWorkOrder, updateWorkOrderAndFetch } from "@/lib/work-orders";
import {
  ExtraAction,
  getExtraActions,
  sortExtraActionsByDueDate,
} from "@/lib/extra-actions";
import {
  archiveCompletedCorrectiveAction,
  completeExtraAction,
} from "@/lib/completed-tasks";
import {
  RFQ_AWAITING_APPROVAL_REASON,
  RFQ_MUST_BE_SENT_REASON,
  buildCloseRfqActionPayload,
  buildOpenRfqActionPayload,
  hasActiveRfqSendAction,
  isRfqSendAction,
  shouldRequestRfqAfterCompletedStep,
  type RfqCloseMode,
} from "@/lib/rfq-workflow";
import { SearchableSelect } from "@/app/components/searchable-select";
import { PageHeader } from "@/app/components/page-header";
import {
  recordTrackedShopStepCompletion,
  syncWorkOrderDataBlockState,
} from "@/lib/work-order-data";
import { isRensOfficeAssigneeName } from "@/lib/manual-office-assignees";
import { formatStaffOptionLabel } from "@/lib/absent-assignment";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
  work_order_type: string | null;
  due_date: string | null;
  current_process_step: string | null;
  hold_reason: string | null;
  rfq_state: string | null;
  rfq_manual_approved_at: string | null;
  required_next_action: string | null;
  action_owner: string | null;
  action_status: string | null;
  action_closed: boolean | null;
  action_created_at: string | null;
  action_closed_at: string | null;
  priority: string | null;
  assigned_person_team: string | null;
  included_process_steps: string[] | null;
  completed_ndt_steps: string[] | null;
  data_tracking_enabled: boolean | null;
};

const SHOP_UPDATE_WORK_ORDER_SELECT =
  "work_order_id, customer, part_number, work_order_type, due_date, current_process_step, hold_reason, rfq_state, rfq_manual_approved_at, required_next_action, action_owner, action_status, action_closed, action_created_at, action_closed_at, priority, assigned_person_team, included_process_steps, completed_ndt_steps, data_tracking_enabled";

type CorrectiveActionTaskItem = {
  kind: "corrective-action";
  order: WorkOrder;
};

type ExtraActionTaskItem = {
  kind: "extra-action";
  action: ExtraAction;
};

type TaskItem = CorrectiveActionTaskItem | ExtraActionTaskItem;

type StaffMember = {
  id: number;
  name: string;
  role: string | null;
  restrictions: string[] | null;
  employment_start_date?: string | null;
};

type Absence = {
  engineer_id: number;
  absence_date: string;
};

type ShopUpdateClientProps = {
  variant: "desktop" | "tablet";
};

function normalizeStatusText(value: string | null | undefined): string {
  return (value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isAwaitingRfqApprovalBlock(order: WorkOrder): boolean {
  return (
    isRfqManualApprovalBlocked(order) ||
    normalizeStatusText(order.hold_reason) ===
      normalizeStatusText(RFQ_AWAITING_APPROVAL_REASON)
  );
}

function isShopRfqBlock(order: WorkOrder): boolean {
  const rfqState = normalizeRfqState(order.rfq_state);
  return (
    isAwaitingRfqApprovalBlock(order) ||
    isRfqSendAction(order) ||
    rfqState === "rfq send" ||
    rfqState === "rfq rejected"
  );
}

function canShopUnblockOrder(order: WorkOrder): boolean {
  return isBlocked(order) && !isShopRfqBlock(order);
}

function getShopUnblockUnavailableMessage(order: WorkOrder): string {
  if (isShopRfqBlock(order)) {
    return "RFQ blocks cannot be unblocked from Shop Update. Use Dashboard or Shared Planning.";
  }

  return "This work order cannot be unblocked from Shop Update.";
}

function getManualUnblockPayload(order: WorkOrder, timestamp: string) {
  return {
    hold_reason: null,
    rfq_manual_approved_at:
      normalizeRfqState(order.rfq_state) === "rfq send"
        ? order.rfq_manual_approved_at ?? timestamp
        : null,
    required_next_action: null,
    action_owner: null,
    action_status: null,
    action_closed: false,
    action_created_at: null,
    action_closed_at: null,
    last_manual_update: timestamp,
  };
}

const COLORS = {
  pageBg: "#f2efe9",
  panelBg: "#ffffff",
  cardBg: "#faf8f3",
  border: "#e2ddd1",
  borderStrong: "#ccc4b4",
  text: "#1f2937",
  textSoft: "#5f6b7c",
  textMuted: "#8590a0",
  heading: "#1f2937",
  blue: "#2555c7",
  blueSoft: "#eef3ff",
  green: "#166534",
  greenSoft: "#eef9f1",
  amberSoft: "#fff6e8",
  red: "#b42318",
  redSoft: "#fff2ef",
  inputBg: "#fffdf9",
  shadow: "0 1px 2px rgba(31, 41, 55, 0.04), 0 4px 12px rgba(31, 41, 55, 0.04)",
};

const FONT_STACK = "var(--font-inter), var(--font-geist-sans), sans-serif";

export function ShopUpdateClient({ variant }: ShopUpdateClientProps) {
  const isTablet = variant === "tablet";
  const majorSectionGap = isTablet ? "52px" : "44px";
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [shopStaff, setShopStaff] = useState<StaffMember[]>([]);
  const [officeStaff, setOfficeStaff] = useState<StaffMember[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedMode, setSelectedMode] = useState<"open" | "blocked" | null>(null);
  const [completedStep, setCompletedStep] = useState("");
  const [stepTouched, setStepTouched] = useState(false);
  const [completedNdtSteps, setCompletedNdtSteps] = useState<string[]>([]);
  const [ndtChecklistError, setNdtChecklistError] = useState(false);
  const [repairNecessary, setRepairNecessary] = useState<boolean | null>(null);
  const [repairDecisionError, setRepairDecisionError] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [requiredNextAction, setRequiredNextAction] = useState("");
  const [actionOwner, setActionOwner] = useState("");
  const [isBlockedUpdate, setIsBlockedUpdate] = useState(false);
  const [todayAbsentEngineerIds, setTodayAbsentEngineerIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const [extraActions, setExtraActions] = useState<ExtraAction[]>([]);
  const [extraActionToClose, setExtraActionToClose] = useState<ExtraAction | null>(null);
  const [extraActionCloseStatus, setExtraActionCloseStatus] = useState("");
  const [isClosingExtraAction, setIsClosingExtraAction] = useState(false);
  const [correctiveActionToClose, setCorrectiveActionToClose] = useState<WorkOrder | null>(null);
  const [rfqCloseMode, setRfqCloseMode] =
    useState<RfqCloseMode>("awaiting_approval");
  const [correctiveActionCloseStatus, setCorrectiveActionCloseStatus] = useState("");
  const [isClosingCorrectiveAction, setIsClosingCorrectiveAction] = useState(false);
  const [isUnblockingSelected, setIsUnblockingSelected] = useState(false);
  const [selectedUnblockConfirmationOpen, setSelectedUnblockConfirmationOpen] =
    useState(false);

  useEffect(() => {
    async function load() {
      const today = workOrderLocalDateKey();
      const [data, staffData, absenceData, extras] = await Promise.all([
        getWorkOrders<WorkOrder>({
          select: SHOP_UPDATE_WORK_ORDER_SELECT,
          isOpen: true,
          isActive: true,
          orderBy: { column: "work_order_id", ascending: false },
        }),
        getEngineers<StaffMember>({
          select: "id, name, role, restrictions",
          isActive: true,
          startedOn: today,
          orderBy: { column: "name" },
        }),
        getEngineerAbsences<Absence>({
          select: "engineer_id, absence_date",
          fromDate: today,
        }),
        getExtraActions(),
      ]);

      setExtraActions(sortExtraActionsByDueDate(extras));
      const activeShopStaff = staffData.filter(
        (staffMember) => staffMember.role === "shop",
      );
      const filteredOrders = data.filter(
        (order) => order.current_process_step !== READY_TO_CLOSE_STEP,
      );
      const withQualificationBlocks = applyTodayQualificationBlocks(
        filteredOrders,
        activeShopStaff,
        absenceData,
        today,
      );
      void Promise.all(
        withQualificationBlocks.map((order) =>
          syncWorkOrderDataBlockState(order).then((result) => {
            if (result.error) {
              console.error(
                `Failed to sync Work Order Data block state for ${order.work_order_id}: ${result.error.message}`,
              );
            }
          }),
        ),
      );
      setOrders(
        sortOrders(
          applySuggestedAssignmentsForCurrentStep(
            withQualificationBlocks,
            activeShopStaff,
            new Set(
              staffData
                .filter((engineer) =>
                  engineer.role === "shop" &&
                  absenceData.some(
                    (absence) =>
                      absence.absence_date === today &&
                      absence.engineer_id === engineer.id,
                  ),
                )
                .map((engineer) => engineer.name),
            ),
          ),
        ),
      );
      setShopStaff(activeShopStaff);
      setOfficeStaff(staffData.filter((staffMember) => staffMember.role === "office"));
      setTodayAbsentEngineerIds(
        Array.from(getAbsentEngineerIdSetForDateKey(absenceData, today)),
      );
      setLoading(false);
    }

    void load();
  }, []);
//noah was hier
  const selectedOrder = useMemo(
    () => orders.find((o) => o.work_order_id === selectedId),
    [orders, selectedId],
  );

  const openOrders = useMemo(
    () =>
      orders.filter(
        (order) => !isBlocked(order) && !hasActiveCorrectiveAction(order),
      ),
    [orders],
  );

  const blockedOrders = useMemo(
    () => orders.filter((order) => isBlocked(order)),
    [orders],
  );

  const todayAbsentEngineerIdSet = useMemo(
    () => new Set(todayAbsentEngineerIds),
    [todayAbsentEngineerIds],
  );

  const todayAbsentShopEngineerNames = useMemo(
    () =>
      new Set(
        shopStaff
          .filter((staffMember) => todayAbsentEngineerIdSet.has(staffMember.id))
          .map((staffMember) => staffMember.name),
      ),
    [shopStaff, todayAbsentEngineerIdSet],
  );

  const completableSteps = getGroupedCompletableStepsForOrder(
    selectedOrder?.work_order_type || null,
    selectedOrder?.included_process_steps ?? null,
  );

  const engineerNames = useMemo(
    () => new Set(shopStaff.map((staffMember) => staffMember.name)),
    [shopStaff],
  );

  const taskItems = useMemo(() => {
    const correctiveActions = orders
      .filter((order) => {
        if (!hasActiveCorrectiveAction(order)) return false;
        if (hasActiveRfqSendAction(order)) return true;
        const owner = getCorrectiveActionContext(order).owner;
        return owner ? engineerNames.has(owner) : false;
      })
      .map<TaskItem>((order) => ({
        kind: "corrective-action",
        order,
      }));

    const additionalTasks = sortExtraActionsByDueDate(extraActions).map<TaskItem>((action) => ({
      kind: "extra-action",
      action,
    }));

    return [...additionalTasks, ...correctiveActions];
  }, [engineerNames, extraActions, orders]);

  const canAddRepairStep = Boolean(
    selectedOrder &&
      canAddRepairAfterInspectionForOrder(
        selectedOrder.work_order_type,
        completedStep,
        selectedOrder.included_process_steps,
      ),
  );

  const previewIncludedSteps =
    selectedOrder && canAddRepairStep && repairNecessary === true
      ? addRepairAfterInspectionForOrder(
          selectedOrder.work_order_type,
          selectedOrder.included_process_steps,
        )
      : selectedOrder?.included_process_steps;

  const includedNdtSteps = getIncludedNdtStepsForOrder(
    selectedOrder?.work_order_type || null,
    previewIncludedSteps ?? selectedOrder?.included_process_steps ?? null,
  );
  const savedCompletedNdtSteps = selectedOrder
    ? getCompletedNdtChecklistForOrder(
        selectedOrder.work_order_type,
        previewIncludedSteps ?? selectedOrder.included_process_steps,
        selectedOrder.current_process_step,
        selectedOrder.completed_ndt_steps,
      )
    : [];
  const savedCompletedNdtStepSet = new Set(savedCompletedNdtSteps);
  const isCompletingNdt = completedStep === NDT_PROCESS_STEP;
  const completedNdtStepSet = new Set(completedNdtSteps);
  const newlyCompletedNdtSteps = completedNdtSteps.filter(
    (step) => !savedCompletedNdtStepSet.has(step),
  );
  const ndtChecklistHasProgress =
    !isCompletingNdt || newlyCompletedNdtSteps.length > 0;
  const ndtChecklistFullyComplete =
    isCompletingNdt &&
    includedNdtSteps.length > 0 &&
    includedNdtSteps.every((step) => completedNdtStepSet.has(step));

  const previewNextStep =
    selectedOrder && completedStep
      ? completedStep === NDT_PROCESS_STEP
        ? getNextProcessStepAfterNdtChecklistForOrder(
            selectedOrder.work_order_type,
            previewIncludedSteps,
            completedNdtSteps,
          )
        : getNextProcessStepAfterGroupedCompletedForOrder(
            selectedOrder.work_order_type,
            completedStep,
            previewIncludedSteps,
          )
      : null;

  const previewRfqCompletedStep =
    selectedOrder &&
    completedStep === NDT_PROCESS_STEP &&
    ndtChecklistFullyComplete
      ? getLastIncludedNdtStepForOrder(
          selectedOrder.work_order_type,
          previewIncludedSteps,
        )
      : completedStep;

  const previewWillRequestRfq = Boolean(
    selectedOrder &&
      completedStep &&
      shouldRequestRfqAfterCompletedStep({
        workOrderType: selectedOrder.work_order_type,
        includedSteps: previewIncludedSteps,
        completedStep: previewRfqCompletedStep,
        rfqState: selectedOrder.rfq_state,
      }),
  );

  function aogPrioritySuffix(order: WorkOrder): string {
    return order.priority === "AOG" ? " - AOG" : "";
  }

  function resetSelectedWorkOrderState() {
    setCompletedStep("");
    setStepTouched(false);
    setCompletedNdtSteps([]);
    setNdtChecklistError(false);
    setRepairNecessary(null);
    setRepairDecisionError(false);
    setHoldReason("");
    setRequiredNextAction("");
    setActionOwner("");
    setIsBlockedUpdate(false);
  }

  function selectOrder(id: string, mode: "open" | "blocked") {
    if (!id) {
      setSelectedId("");
      setSelectedMode(null);
      resetSelectedWorkOrderState();
      setSaveStatus("");
      setIsUnblockingSelected(false);
      setSelectedUnblockConfirmationOpen(false);
      return;
    }

    const order = orders.find((o) => o.work_order_id === id);
    if (!order) return;

    const hasBlocker = Boolean(order.hold_reason?.trim());

    setSelectedId(id);
    setSelectedMode(mode);
    setCompletedStep("");
    setStepTouched(false);
    setCompletedNdtSteps([]);
    setNdtChecklistError(false);
    setRepairNecessary(null);
    setRepairDecisionError(false);
    setHoldReason(order.hold_reason || "");
    setRequiredNextAction(order.required_next_action || "");
    setActionOwner(order.hold_reason?.trim() ? order.action_owner || "" : "");
    setIsBlockedUpdate(mode === "open" && hasBlocker);
    setRfqCloseMode("awaiting_approval");
    setSaveStatus("");
    setIsUnblockingSelected(false);
    setSelectedUnblockConfirmationOpen(false);
  }

  function handleCompletedStepChange(value: string) {
    setCompletedStep(value);
    setStepTouched(true);
    setCompletedNdtSteps(value === NDT_PROCESS_STEP ? savedCompletedNdtSteps : []);
    setNdtChecklistError(false);
    setRepairNecessary(null);
    setRepairDecisionError(false);
  }

  function toggleCompletedNdtStep(step: string, checked: boolean) {
    setCompletedNdtSteps((prev) => {
      const next = new Set(prev);
      if (checked) next.add(step);
      else next.delete(step);
      return Array.from(next);
    });
    setNdtChecklistError(false);
  }

  function setBlockedChoice(blocked: boolean) {
    setIsBlockedUpdate(blocked);

    if (!blocked) {
      setHoldReason("");
      setRequiredNextAction("");
      setActionOwner("");
    }
  }

  function openCloseExtraActionConfirmation(action: ExtraAction) {
    setExtraActionToClose(action);
    setExtraActionCloseStatus("");
    setIsClosingExtraAction(false);
  }

  function closeCloseExtraActionConfirmation() {
    if (isClosingExtraAction) return;
    setExtraActionToClose(null);
    setExtraActionCloseStatus("");
  }

  function openCloseCorrectiveActionConfirmation(order: WorkOrder) {
    setCorrectiveActionToClose(order);
    setRfqCloseMode("awaiting_approval");
    setCorrectiveActionCloseStatus("");
    setIsClosingCorrectiveAction(false);
  }

  function closeCloseCorrectiveActionConfirmation() {
    if (isClosingCorrectiveAction) return;
    setCorrectiveActionToClose(null);
    setCorrectiveActionCloseStatus("");
  }

  function openSelectedUnblockConfirmation() {
    if (!selectedOrder) return;

    if (!canShopUnblockOrder(selectedOrder)) {
      setSaveStatus(getShopUnblockUnavailableMessage(selectedOrder));
      return;
    }

    setSaveStatus("");
    setSelectedUnblockConfirmationOpen(true);
  }

  function closeSelectedUnblockConfirmation() {
    if (isUnblockingSelected) return;
    setSelectedUnblockConfirmationOpen(false);
  }

  async function confirmCloseExtraAction() {
    if (!extraActionToClose) return;

    setIsClosingExtraAction(true);
    setExtraActionCloseStatus("Saving...");

    const { error } = await completeExtraAction(extraActionToClose);

    if (error) {
      setExtraActionCloseStatus(`Error: ${error.message}`);
      setIsClosingExtraAction(false);
      return;
    }

    const closedId = extraActionToClose.id;
    setExtraActions((prev) => prev.filter((a) => a.id !== closedId));
    setExtraActionToClose(null);
    setExtraActionCloseStatus("");
    setIsClosingExtraAction(false);
  }

  async function confirmCloseCorrectiveAction() {
    if (!correctiveActionToClose) return;

    setIsClosingCorrectiveAction(true);
    setCorrectiveActionCloseStatus("Saving...");

    const closedAt = new Date().toISOString();
    const archiveResult = await archiveCompletedCorrectiveAction(
      correctiveActionToClose,
      closedAt,
    );

    if (archiveResult.error) {
      setCorrectiveActionCloseStatus(`Error: ${archiveResult.error.message}`);
      setIsClosingCorrectiveAction(false);
      return;
    }

    const closePayload = isRfqSendAction(correctiveActionToClose)
      ? buildCloseRfqActionPayload({
          mode: rfqCloseMode,
          timestamp: closedAt,
          updateSource: "manual",
        })
      : getCorrectiveActionCompletionPayload(closedAt);

    const { data: savedOrder, error } = await updateWorkOrderAndFetch<WorkOrder>(
      correctiveActionToClose.work_order_id,
      closePayload,
      SHOP_UPDATE_WORK_ORDER_SELECT,
    );

    if (error || !savedOrder) {
      setCorrectiveActionCloseStatus(
        `Error: ${error?.message || "Unable to complete the corrective action."}`,
      );
      setIsClosingCorrectiveAction(false);
      return;
    }

    const blockResult = await syncWorkOrderDataBlockState(savedOrder);
    if (blockResult.error) {
      console.error(
        `Failed to sync Work Order Data block state for ${savedOrder.work_order_id}: ${blockResult.error.message}`,
      );
    }

    setOrders((prev) =>
      prev.map((order) =>
        order.work_order_id === savedOrder.work_order_id ? savedOrder : order,
      ),
    );
    setCorrectiveActionToClose(null);
    setCorrectiveActionCloseStatus("");
    setIsClosingCorrectiveAction(false);
  }

  async function saveUpdate() {
    if (!selectedId || !selectedOrder) return;
    if (selectedMode !== "open") return;

    if (isBlocked(selectedOrder) || hasActiveCorrectiveAction(selectedOrder)) {
      setSaveStatus("This work order is blocked and cannot be updated by shop.");
      setSelectedId("");
      setSelectedMode(null);
      return;
    }

    const hasCompletedStep = Boolean(completedStep);
    const repairDecisionRequired =
      hasCompletedStep &&
      canAddRepairAfterInspectionForOrder(
        selectedOrder.work_order_type,
        completedStep,
        selectedOrder.included_process_steps,
      );

    if (repairDecisionRequired && repairNecessary === null) {
      setRepairDecisionError(true);
      setSaveStatus("Please choose whether repair is necessary.");
      return;
    }

    if (hasCompletedStep && completedStep === NDT_PROCESS_STEP && !ndtChecklistHasProgress) {
      setNdtChecklistError(true);
      setSaveStatus("Please check at least one new NDT inspection.");
      return;
    }

    if (isBlockedUpdate && !holdReason.trim()) {
      setSaveStatus("Please enter a hold reason.");
      return;
    }

    const normalizedHoldReason = holdReason.trim();
    const normalizedRequiredNextAction = requiredNextAction.trim();
    const normalizedActionOwner = actionOwner.trim();
    const nowIso = new Date().toISOString();
    let shouldAddRepairStep = false;
    let includedProcessStepsForSave = selectedOrder.included_process_steps;
    let nextProcessStep = selectedOrder.current_process_step;
    let assignedPersonTeam = selectedOrder.assigned_person_team;
    let shouldOpenRfqAction = false;
    let actualCompletedSteps: string[] = [];
    let completedNdtStepsForSave = selectedOrder.completed_ndt_steps;

    if (hasCompletedStep) {
      shouldAddRepairStep =
        canAddRepairAfterInspectionForOrder(
          selectedOrder.work_order_type,
          completedStep,
          selectedOrder.included_process_steps,
        ) && repairNecessary === true;
      includedProcessStepsForSave = shouldAddRepairStep
        ? addRepairAfterInspectionForOrder(
            selectedOrder.work_order_type,
            selectedOrder.included_process_steps,
          )
        : selectedOrder.included_process_steps;
      if (completedStep === NDT_PROCESS_STEP) {
        const savedNdtSteps = getCompletedNdtChecklistForOrder(
          selectedOrder.work_order_type,
          includedProcessStepsForSave,
          selectedOrder.current_process_step,
          selectedOrder.completed_ndt_steps,
        );
        const savedNdtStepSet = new Set(savedNdtSteps);
        completedNdtStepsForSave = normalizeCompletedNdtStepsForOrder(
          selectedOrder.work_order_type,
          includedProcessStepsForSave,
          completedNdtSteps,
        );
        actualCompletedSteps = completedNdtStepsForSave.filter(
          (step) => !savedNdtStepSet.has(step),
        );
      } else {
        actualCompletedSteps = getActualCompletedStepsForGroupedCompletion(
          selectedOrder.work_order_type,
          completedStep,
          includedProcessStepsForSave,
          selectedOrder.current_process_step,
        );
      }
      const ndtFullyCompleteForSave =
        completedStep === NDT_PROCESS_STEP &&
        includedNdtSteps.length > 0 &&
        includedNdtSteps.every((step) =>
          (completedNdtStepsForSave ?? []).includes(step),
        );
      const rfqCompletedStep =
        completedStep === NDT_PROCESS_STEP
          ? ndtFullyCompleteForSave
            ? getLastIncludedNdtStepForOrder(
                selectedOrder.work_order_type,
                includedProcessStepsForSave,
              )
            : null
          : completedStep;
      nextProcessStep =
        completedStep === NDT_PROCESS_STEP
          ? getNextProcessStepAfterNdtChecklistForOrder(
              selectedOrder.work_order_type,
              includedProcessStepsForSave,
              completedNdtStepsForSave,
            ) ?? selectedOrder.current_process_step
          : getNextProcessStepAfterGroupedCompletedForOrder(
              selectedOrder.work_order_type,
              completedStep,
              includedProcessStepsForSave,
            ) ?? completedStep;
      shouldOpenRfqAction =
        !isBlockedUpdate &&
        Boolean(rfqCompletedStep) &&
        shouldRequestRfqAfterCompletedStep({
          workOrderType: selectedOrder.work_order_type,
          includedSteps: includedProcessStepsForSave,
          completedStep: rfqCompletedStep,
          rfqState: selectedOrder.rfq_state,
        });

      const completedStepWasRestricted = actualCompletedSteps.some((step) =>
        hasActiveRestrictionForStep(step, shopStaff),
      );
      const nextStepIsRestricted = hasActiveRestrictionForStep(
        nextProcessStep,
        shopStaff,
      );
      const autoAssignBasis = isRensOfficeAssigneeName(
        selectedOrder.assigned_person_team,
      )
        ? DEFAULT_ASSIGNED_PERSON_TEAM
        : selectedOrder.assigned_person_team;
      assignedPersonTeam =
        completedStepWasRestricted && !nextStepIsRestricted
          ? DEFAULT_ASSIGNED_PERSON_TEAM
          : autoAssignForStep(
              autoAssignBasis,
              nextProcessStep,
              shopStaff,
              todayAbsentShopEngineerNames,
              selectedOrder.work_order_type,
            );
    }

    setSaveStatus("Saving...");

    const actionPayload = shouldOpenRfqAction
      ? buildOpenRfqActionPayload(nowIso)
      : {
          hold_reason: isBlockedUpdate ? normalizedHoldReason : null,
          required_next_action:
            isBlockedUpdate && normalizedRequiredNextAction
              ? normalizedRequiredNextAction
              : null,
          action_owner:
            isBlockedUpdate && normalizedActionOwner
              ? normalizedActionOwner
              : null,
          action_status: isBlockedUpdate ? "Open" : null,
          action_closed: false,
          action_created_at:
            isBlockedUpdate && normalizedRequiredNextAction ? nowIso : null,
          action_closed_at: null,
        };

    const payload = {
      ...(hasCompletedStep
        ? {
            current_process_step: nextProcessStep,
            assigned_person_team: assignedPersonTeam,
          }
        : {}),
      ...actionPayload,
      last_manual_update: nowIso,
      ...(shouldAddRepairStep
        ? { included_process_steps: includedProcessStepsForSave }
        : {}),
      ...(completedStep === NDT_PROCESS_STEP
        ? { completed_ndt_steps: completedNdtStepsForSave }
        : {}),
    };

    const { error } = await updateWorkOrder(selectedId, payload);

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    if (hasCompletedStep && selectedOrder.data_tracking_enabled) {
      let trackingCurrentProcessStep = selectedOrder.current_process_step;

      for (const actualCompletedStep of actualCompletedSteps) {
        const trackingNextProcessStep =
          getNextProcessStepAfterCompletedForOrder(
            selectedOrder.work_order_type,
            actualCompletedStep,
            includedProcessStepsForSave,
          ) ?? actualCompletedStep;
        const trackingResult = await recordTrackedShopStepCompletion({
          selectedOrder: {
            ...selectedOrder,
            current_process_step: trackingCurrentProcessStep,
            included_process_steps: includedProcessStepsForSave,
          },
          completedStep: actualCompletedStep,
          nextProcessStep: trackingNextProcessStep,
        });
        if (trackingResult.error) {
          console.error(
            `Failed to record Work Order Data step for ${selectedOrder.work_order_id}: ${trackingResult.error.message}`,
          );
        }
        trackingCurrentProcessStep = trackingNextProcessStep;
      }
    }

    const nextOrder = {
      ...selectedOrder,
      ...payload,
      current_process_step: hasCompletedStep
        ? nextProcessStep
        : selectedOrder.current_process_step,
      included_process_steps: hasCompletedStep
        ? includedProcessStepsForSave
        : selectedOrder.included_process_steps,
      completed_ndt_steps:
        completedStep === NDT_PROCESS_STEP
          ? completedNdtStepsForSave
          : selectedOrder.completed_ndt_steps,
    };
    const blockResult = await syncWorkOrderDataBlockState(nextOrder);
    if (blockResult.error) {
      console.error(
        `Failed to sync Work Order Data block state for ${selectedOrder.work_order_id}: ${blockResult.error.message}`,
      );
    }

    setOrders((prev) =>
      prev.map((o) =>
        o.work_order_id === selectedId
          ? {
              ...o,
              ...payload,
            }
          : o,
      ),
    );

    const savedId = selectedId;

    setSelectedId("");
    setSelectedMode(null);
    setCompletedStep("");
    setStepTouched(false);
    setCompletedNdtSteps([]);
    setNdtChecklistError(false);
    setRepairNecessary(null);
    setRepairDecisionError(false);
    setHoldReason("");
    setRequiredNextAction("");
    setActionOwner("");
    setIsBlockedUpdate(false);
    setSaveStatus(`${savedId} updated. Select the next work order.`);
  }

  async function unblockSelectedWorkOrder() {
    if (!selectedOrder) return;

    if (!canShopUnblockOrder(selectedOrder)) {
      setSaveStatus(getShopUnblockUnavailableMessage(selectedOrder));
      return;
    }

    setIsUnblockingSelected(true);
    setSelectedUnblockConfirmationOpen(false);
    setSaveStatus("Saving...");

    const updatedAt = new Date().toISOString();
    const hasCorrectiveAction = hasActiveCorrectiveAction(selectedOrder);

    if (hasCorrectiveAction) {
      const archiveResult = await archiveCompletedCorrectiveAction(
        selectedOrder,
        updatedAt,
      );

      if (archiveResult.error) {
        setSaveStatus(`Error: ${archiveResult.error.message}`);
        setIsUnblockingSelected(false);
        return;
      }
    }

    const unblockPayload = hasCorrectiveAction
      ? getCorrectiveActionCompletionPayload(updatedAt)
      : getManualUnblockPayload(selectedOrder, updatedAt);

    const { data: savedOrder, error } = await updateWorkOrderAndFetch<WorkOrder>(
      selectedOrder.work_order_id,
      unblockPayload,
      SHOP_UPDATE_WORK_ORDER_SELECT,
    );

    if (error || !savedOrder) {
      setSaveStatus(`Error: ${error?.message || "Unable to unblock the work order."}`);
      setIsUnblockingSelected(false);
      return;
    }

    const blockResult = await syncWorkOrderDataBlockState(savedOrder);
    if (blockResult.error) {
      console.error(
        `Failed to sync Work Order Data block state for ${savedOrder.work_order_id}: ${blockResult.error.message}`,
      );
    }

    setOrders((prev) =>
      sortOrders(
        prev.map((order) =>
          order.work_order_id === savedOrder.work_order_id ? savedOrder : order,
        ),
      ),
    );

    setSelectedId("");
    setSelectedMode(null);
    resetSelectedWorkOrderState();
    setIsUnblockingSelected(false);
    setSelectedUnblockConfirmationOpen(false);
    setSaveStatus(
      isBlocked(savedOrder)
        ? `Action completed for ${savedOrder.work_order_id}. Still blocked: ${blockReason(savedOrder, {
            rfqSentLabel: RFQ_AWAITING_APPROVAL_REASON,
          })}.`
        : `Work order ${savedOrder.work_order_id} unblocked. Select the next work order.`,
    );
  }

  const pageStyle: CSSProperties = {
    minHeight: "100vh",
    backgroundColor: COLORS.pageBg,
    padding: isTablet ? "28px 22px 44px" : "var(--layout-page-py) var(--layout-page-px) var(--layout-page-px)",
    fontFamily: FONT_STACK,
    color: COLORS.text,
  };

  const shellStyle: CSSProperties = {
    width: "100%",
    maxWidth: isTablet ? "760px" : "var(--layout-content-max-w)",
    marginInline: "auto",
  };

  const sectionCard: CSSProperties = {
    backgroundColor: COLORS.panelBg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: isTablet ? "22px" : "var(--card-radius)",
    padding: isTablet ? "22px" : "var(--card-py) var(--card-px)",
    boxShadow: COLORS.shadow,
    minWidth: 0,
  };

  const innerCard: CSSProperties = {
    backgroundColor: COLORS.cardBg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: isTablet ? "18px" : "var(--card-radius)",
    padding: isTablet ? "18px" : "12px",
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: isTablet ? "16px 16px" : "8px 10px",
    border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: isTablet ? "14px" : "8px",
    fontSize: isTablet ? "18px" : "var(--fs-body)",
    boxSizing: "border-box",
    backgroundColor: COLORS.inputBg,
    color: COLORS.text,
    minHeight: isTablet ? "58px" : "36px",
    outline: "none",
  };

  const subtitleStyle: CSSProperties = {
    margin: "4px 0 0",
    fontSize: isTablet ? "16px" : "var(--fs-body)",
    color: COLORS.textSoft,
    lineHeight: 1.5,
  };

  const fieldTitleStyle: CSSProperties = {
    fontSize: isTablet ? "22px" : "var(--fs-heading)",
    fontWeight: 650,
    color: COLORS.heading,
    margin: 0,
    letterSpacing: "-0.015em",
  };

  const eyebrowStyle: CSSProperties = {
    fontSize: isTablet ? "12px" : "var(--fs-xs)",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: COLORS.textMuted,
    marginBottom: "4px",
  };

  const choiceBtn = (active: boolean): CSSProperties => ({
    flex: 1,
    padding: isTablet ? "17px 16px" : "8px 10px",
    borderRadius: isTablet ? "15px" : "8px",
    border: `1px solid ${active ? "#d7e3ff" : COLORS.border}`,
    backgroundColor: active ? COLORS.blueSoft : COLORS.panelBg,
    color: active ? COLORS.blue : COLORS.textSoft,
    fontWeight: 700,
    fontSize: isTablet ? "17px" : "var(--fs-sm)",
    cursor: "pointer",
    boxShadow: active ? "0 1px 2px rgba(31, 41, 55, 0.04)" : "none",
    minHeight: isTablet ? "58px" : undefined,
  });

  const primaryBtn: CSSProperties = {
    padding: isTablet ? "17px 24px" : "9px 16px",
    backgroundColor: COLORS.blue,
    color: "white",
    border: `1px solid ${COLORS.blue}`,
    borderRadius: isTablet ? "16px" : "8px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: isTablet ? "18px" : "var(--fs-body)",
    boxShadow: "0 6px 16px rgba(37, 85, 199, 0.16)",
    minHeight: isTablet ? "60px" : undefined,
  };

  const sectionDividerStyle: CSSProperties = {
    height: "1px",
    backgroundColor: COLORS.border,
    margin: isTablet ? "22px 0" : "18px 0",
  };

  if (loading) {
    return (
      <div style={{ ...pageStyle, color: COLORS.textSoft }}>
        Loading...
      </div>
    );
  }

  const workOrderOptions = openOrders.map((o) => ({
    value: o.work_order_id,
    label: `${o.work_order_id} - PN: ${o.part_number || "-"} - ${o.customer || "-"} - ${o.work_order_type || "-"}${aogPrioritySuffix(o)}`,
  }));

  const blockedWorkOrderOptions = blockedOrders.map((o) => ({
    value: o.work_order_id,
    label: `${o.work_order_id} - ${o.part_number || "-"} - ${o.customer || "-"}`,
  }));
  const selectedOrderCanBeUnblocked = selectedOrder
    ? canShopUnblockOrder(selectedOrder)
    : false;
  const selectedOrderHasShopRfqBlock = selectedOrder
    ? isShopRfqBlock(selectedOrder)
    : false;

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <PageHeader
          title={isTablet ? "Shop Form" : "Shop Update"}
          description={
            isTablet
              ? "Touch-friendly shop update for portrait iPad. Select an open work order to update, or unblock a blocked work order that can continue."
              : "Select an open work order to update, or unblock a blocked work order that can continue."
          }
        />

        <section
          style={{
            ...sectionCard,
            marginBottom: majorSectionGap,
          }}
        >
          <h2 style={{ ...fieldTitleStyle, fontSize: isTablet ? "25px" : "17px", marginBottom: "4px" }}>
            Search for a work order
          </h2>
          <p style={{ ...subtitleStyle, marginBottom: isTablet ? "18px" : "14px" }}>
            {openOrders.length} open work orders available.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isTablet ? "1fr" : "minmax(0, 1.65fr) minmax(0, 1fr)",
              gap: isTablet ? "16px" : "var(--gap-default)",
            }}
          >
            <div style={innerCard}>
              <div style={eyebrowStyle}>Search</div>
              <SearchableSelect
                options={workOrderOptions}
                value={selectedMode === "open" ? selectedId : ""}
                onChange={(v) => selectOrder(v, "open")}
                placeholder="Search by work order, part number or customer..."
                style={{ marginTop: "2px" }}
                inputStyle={
                  isTablet
                    ? {
                        padding: "16px",
                        borderRadius: "14px",
                        fontSize: "18px",
                        minHeight: "58px",
                        backgroundColor: COLORS.inputBg,
                        borderColor: COLORS.borderStrong,
                      }
                    : undefined
                }
                optionStyle={
                  isTablet
                    ? {
                        padding: "15px 16px",
                        fontSize: "17px",
                      }
                    : undefined
                }
              />
            </div>

            <div style={innerCard}>
              <div style={eyebrowStyle}>Browse list</div>
              <select
                value={selectedMode === "open" ? selectedId : ""}
                onChange={(e) => selectOrder(e.target.value, "open")}
                style={inputStyle}
              >
                <option value="">Select from list...</option>
                {openOrders.map((o) => (
                  <option key={o.work_order_id} value={o.work_order_id}>
                    {o.work_order_id} - {o.part_number || "-"} - {o.customer || "-"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedOrder && selectedMode === "open" && (
            <div>
              <div style={sectionDividerStyle} />
              <div style={eyebrowStyle}>Selected work order</div>
              <h2 style={{ ...fieldTitleStyle, fontSize: isTablet ? "25px" : "17px", marginBottom: isTablet ? "18px" : "12px" }}>
                Current work order details
              </h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isTablet ? "1fr 1fr" : "repeat(6, minmax(0, 1fr))",
                  gap: isTablet ? "14px" : "10px",
                }}
              >
                <InfoBox label="Work Order" value={selectedOrder.work_order_id} large={isTablet} />
                <InfoBox label="Customer" value={selectedOrder.customer || "-"} large={isTablet} />
                <InfoBox label="Part Number" value={selectedOrder.part_number || "-"} large={isTablet} />
                <InfoBox label="Work Order Type" value={selectedOrder.work_order_type || "-"} large={isTablet} />
                <InfoBox
                  label="Current Step"
                  value={getProcessStepDisplayName(selectedOrder.current_process_step) || "-"}
                  large={isTablet}
                />
                <InfoBox
                  label="Assigned"
                  value={normalizeAssignedPersonTeam(selectedOrder.assigned_person_team)}
                  large={isTablet}
                />
              </div>
                  <div style={sectionDividerStyle} />
                  <div style={eyebrowStyle}>Work order update</div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isTablet ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)",
                      gap: isTablet ? "22px" : "12px",
                    }}
                  >
                    <div style={sectionCard}>
                      <div style={eyebrowStyle}>Step update</div>
                      <h2 style={{ ...fieldTitleStyle, fontSize: isTablet ? "25px" : "17px", marginBottom: "4px" }}>
                        Completed Step
                      </h2>

                      {completableSteps.length > 0 ? (
                        <>
                          <select
                            value={completedStep}
                            onChange={(e) => handleCompletedStepChange(e.target.value)}
                            style={inputStyle}
                          >
                            <option value="">Select completed step...</option>
                            {completableSteps.map((step) => (
                              <option key={step} value={step}>
                                {step}
                              </option>
                            ))}
                          </select>

                          {isCompletingNdt && includedNdtSteps.length > 0 && (
                            <div
                              style={{
                                display: "grid",
                                gap: isTablet ? "12px" : "8px",
                                marginTop: isTablet ? "18px" : "12px",
                                padding: isTablet ? "18px" : "12px",
                                backgroundColor: "#fffdfa",
                                border: `1px solid ${
                                  ndtChecklistError ? COLORS.red : COLORS.border
                                }`,
                                borderRadius: isTablet ? "18px" : "10px",
                                boxShadow: ndtChecklistError
                                  ? `0 0 0 3px ${COLORS.redSoft}`
                                  : undefined,
                              }}
                            >
                              <div>
                                <div style={eyebrowStyle}>NDT</div>
                                <h3
                                  style={{
                                    ...fieldTitleStyle,
                                    fontSize: isTablet ? "22px" : "var(--fs-md)",
                                    marginBottom: "0",
                                  }}
                                >
                                  Completed inspections
                                </h3>
                              </div>
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: isTablet
                                    ? "1fr"
                                    : "repeat(auto-fit, minmax(180px, 1fr))",
                                  gap: isTablet ? "10px" : "8px",
                                }}
                              >
                                {includedNdtSteps.map((step) => (
                                  <label
                                    key={step}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      color: savedCompletedNdtStepSet.has(step)
                                        ? COLORS.textMuted
                                        : COLORS.text,
                                      fontSize: isTablet ? "18px" : "var(--fs-sm)",
                                      fontWeight: 650,
                                      cursor: savedCompletedNdtStepSet.has(step)
                                        ? "default"
                                        : "pointer",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={completedNdtStepSet.has(step)}
                                      disabled={savedCompletedNdtStepSet.has(step)}
                                      onChange={(e) =>
                                        toggleCompletedNdtStep(
                                          step,
                                          e.target.checked,
                                        )
                                      }
                                    />
                                    {step}
                                  </label>
                                ))}
                              </div>
                              {ndtChecklistError && (
                                <StatusNote color="red" large={isTablet}>
                                  Please fill this in.
                                </StatusNote>
                              )}
                            </div>
                          )}

                          {canAddRepairStep && (
                            <div
                              style={{
                                display: "grid",
                                gap: isTablet ? "12px" : "8px",
                                marginTop: isTablet ? "18px" : "12px",
                                padding: isTablet ? "18px" : "12px",
                                backgroundColor: "#fffdfa",
                                border: `1px solid ${
                                  repairDecisionError ? COLORS.red : COLORS.border
                                }`,
                                borderRadius: isTablet ? "18px" : "10px",
                                boxShadow: repairDecisionError
                                  ? `0 0 0 3px ${COLORS.redSoft}`
                                  : undefined,
                              }}
                            >
                              <div>
                                <div style={eyebrowStyle}>Inspection result</div>
                                <h3
                                  style={{
                                    ...fieldTitleStyle,
                                    fontSize: isTablet ? "22px" : "var(--fs-md)",
                                    marginBottom: "0",
                                  }}
                                >
                                  Repair necessary?
                                </h3>
                              </div>
                              <div style={{ display: "flex", gap: isTablet ? "14px" : "8px" }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRepairNecessary(false);
                                    setRepairDecisionError(false);
                                  }}
                                  style={choiceBtn(repairNecessary === false)}
                                >
                                  No
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRepairNecessary(true);
                                    setRepairDecisionError(false);
                                  }}
                                  style={choiceBtn(repairNecessary === true)}
                                >
                                  Yes
                                </button>
                              </div>
                              {repairDecisionError && (
                                <StatusNote color="red" large={isTablet}>
                                  Please fill this in.
                                </StatusNote>
                              )}
                            </div>
                          )}

                          {completedStep && previewWillRequestRfq && (
                            <StatusNote
                              color="red"
                              large={isTablet}
                              style={{ marginTop: isTablet ? "14px" : "8px" }}
                            >
                              After saving, this work order will be blocked:{" "}
                              {RFQ_MUST_BE_SENT_REASON}.
                            </StatusNote>
                          )}

                          {stepTouched &&
                            completedStep &&
                            previewNextStep &&
                            previewNextStep !== READY_TO_CLOSE_STEP && (
                              <StatusNote color="blue" large={isTablet}>
                                Next step: {getProcessStepDisplayName(previewNextStep)}
                              </StatusNote>
                            )}

                          {stepTouched &&
                            completedStep &&
                            previewNextStep === READY_TO_CLOSE_STEP && (
                              <StatusNote color="green" large={isTablet}>
                                Final step completed - ready to close
                              </StatusNote>
                            )}
                        </>
                      ) : (
                        <StatusNote color="red" large={isTablet}>
                          No steps available - work order type is not set.
                        </StatusNote>
                      )}
                    </div>

                    <div style={sectionCard}>
                      <div style={eyebrowStyle}>Blocker update</div>
                      <h2 style={{ ...fieldTitleStyle, fontSize: isTablet ? "25px" : "17px", marginBottom: "4px" }}>
                        Blocked?
                      </h2>
                      <p style={{ ...subtitleStyle, marginBottom: isTablet ? "18px" : "14px" }}>
                        Only complete this section if the work cannot continue.
                      </p>

                      <div style={{ display: "flex", gap: isTablet ? "14px" : "8px", marginBottom: isTablet ? "18px" : "12px" }}>
                        <button type="button" onClick={() => setBlockedChoice(false)} style={choiceBtn(!isBlockedUpdate)}>
                          No
                        </button>
                        <button type="button" onClick={() => setBlockedChoice(true)} style={choiceBtn(isBlockedUpdate)}>
                          Yes
                        </button>
                      </div>

                      {isBlockedUpdate && (
                        <div
                          style={{
                            display: "grid",
                            gap: isTablet ? "14px" : "8px",
                            padding: isTablet ? "18px" : "12px",
                            backgroundColor: "#fffdfa",
                            border: `1px solid ${COLORS.border}`,
                            borderRadius: isTablet ? "18px" : "10px",
                          }}
                        >
                          <input
                            value={holdReason}
                            onChange={(e) => setHoldReason(e.target.value)}
                            placeholder="Hold reason..."
                            style={inputStyle}
                          />
                          <input
                            value={requiredNextAction}
                            onChange={(e) => setRequiredNextAction(e.target.value)}
                            placeholder="Action required..."
                            style={inputStyle}
                          />
                          <div>
                            <div style={eyebrowStyle}>Action owner</div>
                            <select
                              value={actionOwner}
                              onChange={(e) => setActionOwner(e.target.value)}
                              style={inputStyle}
                            >
                              <option value="">Select owner...</option>
                              {officeStaff.length > 0 && (
                                <optgroup label="Office">
                                  {officeStaff.map((staffMember) => (
                                    <option key={staffMember.id} value={staffMember.name}>
                                      {staffMember.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {shopStaff.length > 0 && (
                                <optgroup label="Shop">
                                  {shopStaff.map((staffMember) => (
                                    <option key={staffMember.id} value={staffMember.name}>
                                      {formatStaffOptionLabel(
                                        staffMember,
                                        todayAbsentEngineerIdSet,
                                      )}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </div>
                          <div style={{ fontSize: isTablet ? "15px" : "var(--fs-sm)", color: COLORS.textSoft, paddingTop: "2px" }}>
                            Status will be saved as <strong>Open</strong>.
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginTop: isTablet ? "24px" : "14px",
                    }}
                  >
                    <button
                      onClick={() => void saveUpdate()}
                      style={{ ...primaryBtn, width: isTablet ? "100%" : undefined }}
                    >
                      Save Update
                    </button>
                  </div>
            </div>
          )}
        </section>

        <section style={{ ...sectionCard, marginBottom: majorSectionGap }}>
          <h2 style={{ ...fieldTitleStyle, fontSize: isTablet ? "25px" : "17px", marginBottom: "4px" }}>
            Blocked work orders
          </h2>
          <p style={{ ...subtitleStyle, marginBottom: isTablet ? "18px" : "14px" }}>
            {blockedOrders.length} blocked work order{blockedOrders.length !== 1 ? "s" : ""} at this moment. 
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isTablet ? "1fr" : "minmax(0, 1.65fr) minmax(0, 1fr)",
              gap: isTablet ? "16px" : "var(--gap-default)",
            }}
          >
            <div style={innerCard}>
              <div style={eyebrowStyle}>Search blocked</div>
              <SearchableSelect
                options={blockedWorkOrderOptions}
                value={selectedMode === "blocked" ? selectedId : ""}
                onChange={(v) => selectOrder(v, "blocked")}
                placeholder="Search blocked work orders..."
                style={{ marginTop: "2px" }}
                inputStyle={
                  isTablet
                    ? {
                        padding: "16px",
                        borderRadius: "14px",
                        fontSize: "18px",
                        minHeight: "58px",
                        backgroundColor: COLORS.inputBg,
                        borderColor: COLORS.borderStrong,
                      }
                    : undefined
                }
                optionStyle={
                  isTablet
                    ? {
                        padding: "15px 16px",
                        fontSize: "17px",
                      }
                    : undefined
                }
              />
            </div>

            <div style={innerCard}>
              <div style={eyebrowStyle}>Blocked list</div>
              <select
                value={selectedMode === "blocked" ? selectedId : ""}
                onChange={(e) => selectOrder(e.target.value, "blocked")}
                style={inputStyle}
              >
                <option value="">Select blocked order...</option>
                {blockedOrders.map((o) => (
                  <option key={o.work_order_id} value={o.work_order_id}>
                    {o.work_order_id} - {o.part_number || "-"} - {o.customer || "-"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedOrder && selectedMode === "blocked" && (
            <>
              <div style={sectionDividerStyle} />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isTablet ? "1fr" : "minmax(0, 1fr) auto",
                  gap: isTablet ? "14px" : "16px",
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: isTablet ? "22px" : "18px",
                      fontWeight: 750,
                      color: COLORS.text,
                      lineHeight: 1.2,
                    }}
                  >
                    {selectedOrder.work_order_id}
                  </div>
                  <div
                    style={{
                      marginTop: "3px",
                      fontSize: isTablet ? "15px" : "var(--fs-sm)",
                      color: COLORS.textSoft,
                      lineHeight: 1.35,
                    }}
                  >
                    {selectedOrder.customer || "-"}
                    {selectedOrder.part_number ? ` - PN: ${selectedOrder.part_number}` : ""}
                  </div>
                  <div
                    style={{
                      marginTop: isTablet ? "8px" : "6px",
                      fontSize: isTablet ? "16px" : "var(--fs-body)",
                      fontWeight: 700,
                      color: selectedOrderCanBeUnblocked ? COLORS.red : COLORS.red,
                      lineHeight: 1.3,
                    }}
                  >
                    Blocked: {blockReason(selectedOrder, {
                      rfqSentLabel: RFQ_AWAITING_APPROVAL_REASON,
                    })}
                  </div>
                  {!selectedOrderCanBeUnblocked && (
                    <div
                      style={{
                        marginTop: "3px",
                        fontSize: isTablet ? "14px" : "var(--fs-sm)",
                        color: COLORS.textSoft,
                        lineHeight: 1.3,
                      }}
                    >
                    </div>
                  )}
                </div>
                {!selectedOrderHasShopRfqBlock && (
                  <button
                    onClick={openSelectedUnblockConfirmation}
                    disabled={!selectedOrderCanBeUnblocked || isUnblockingSelected}
                    style={{
                      ...primaryBtn,
                      width: isTablet ? "100%" : "144px",
                      minHeight: isTablet ? "56px" : "40px",
                      fontSize: isTablet ? "17px" : "14px",
                      boxShadow: "0 4px 12px rgba(37, 85, 199, 0.12)",
                      opacity:
                        !selectedOrderCanBeUnblocked || isUnblockingSelected
                          ? 0.72
                          : 1,
                    }}
                  >
                    {!selectedOrderCanBeUnblocked
                      ? "Cannot unblock"
                      : isUnblockingSelected
                        ? "Saving..."
                        : "Unblock"}
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <section style={sectionCard}>
          <h2 style={{ ...fieldTitleStyle, fontSize: isTablet ? "25px" : "17px", marginBottom: "4px" }}>
            Complete an additional task
          </h2>
          <p style={{ ...subtitleStyle, marginBottom: isTablet ? "18px" : "14px" }}>
            {taskItems.length === 0
              ? "No additional tasks outstanding."
              : `${taskItems.length} additional task${taskItems.length !== 1 ? "s" : ""} outstanding.`}
          </p>

          {taskItems.length > 0 && (
            <div style={{ display: "grid", gap: isTablet ? "14px" : "10px" }}>
              {taskItems.map((item) => {
                const isCorrectiveAction = item.kind === "corrective-action";
                const isRfqAction =
                  isCorrectiveAction && hasActiveRfqSendAction(item.order);
                const workOrderLabel = isCorrectiveAction
                  ? item.order.work_order_id
                  : "-";
                const workOrderMeta = isCorrectiveAction
                  ? [item.order.customer, item.order.part_number ? `PN: ${item.order.part_number}` : null]
                      .filter(Boolean)
                      .join(" - ")
                  : "";
                const description = isCorrectiveAction
                  ? getCorrectiveActionContext(item.order).action || "-"
                  : item.action.description;
                const descriptionMeta = isCorrectiveAction
                  ? [
                      item.order.work_order_type,
                      getProcessStepDisplayName(item.order.current_process_step),
                    ]
                      .filter(Boolean)
                      .join(" - ")
                  : "";
                const responsible = isRfqAction
                  ? "-"
                  : isCorrectiveAction
                    ? normalizeAssignedPersonTeam(getCorrectiveActionContext(item.order).owner)
                    : normalizeAssignedPersonTeam(item.action.responsible_person_team);
                const dueDateLabel = isCorrectiveAction
                  ? formatDate(item.order.due_date)
                  : formatDate(item.action.due_date);

                return (
                <div
                  key={
                    isCorrectiveAction
                      ? `corrective-${item.order.work_order_id}`
                      : `extra-${item.action.id}`
                  }
                  style={{
                    display: "grid",
                    gridTemplateColumns: isTablet
                      ? "repeat(2, minmax(0, 1fr))"
                      : "minmax(140px, 0.95fr) minmax(0, 1.6fr) minmax(110px, 0.85fr) minmax(90px, 0.7fr) auto",
                    gap: isTablet ? "14px" : "10px",
                    alignItems: "center",
                    padding: isTablet ? "18px" : "10px 12px",
                    borderRadius: isTablet ? "18px" : "10px",
                    border: `1px solid ${COLORS.border}`,
                    backgroundColor: COLORS.cardBg,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={eyebrowStyle}>Work order</div>
                    <div style={{ fontSize: isTablet ? "18px" : "var(--fs-md)", fontWeight: 700, color: COLORS.text }}>
                      {workOrderLabel}
                    </div>
                    {workOrderMeta && (
                      <div style={{ marginTop: "2px", fontSize: isTablet ? "14px" : "var(--fs-sm)", color: COLORS.textSoft, lineHeight: 1.35 }}>
                        {workOrderMeta}
                      </div>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={eyebrowStyle}>Description</div>
                    <div style={{ fontSize: isTablet ? "18px" : "var(--fs-md)", fontWeight: 600, color: COLORS.text }}>
                      {description}
                    </div>
                    {descriptionMeta && (
                      <div style={{ marginTop: "2px", fontSize: isTablet ? "14px" : "var(--fs-sm)", color: COLORS.textSoft, lineHeight: 1.35 }}>
                        {descriptionMeta}
                      </div>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={eyebrowStyle}>Responsible</div>
                    <div style={{ fontSize: isTablet ? "16px" : "var(--fs-body)", color: COLORS.text }}>
                      {responsible}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={eyebrowStyle}>Due date</div>
                    <div style={{ fontSize: isTablet ? "16px" : "var(--fs-body)", color: COLORS.text }}>
                      {dueDateLabel}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      isCorrectiveAction
                        ? openCloseCorrectiveActionConfirmation(item.order)
                        : openCloseExtraActionConfirmation(item.action)
                    }
                    style={{
                      ...primaryBtn,
                      width: isTablet ? "100%" : undefined,
                      ...(isTablet ? { gridColumn: "1 / -1" } : {}),
                    }}
                  >
                    Complete
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </section>

        {saveStatus && (
          <div
            style={{
              marginTop: "12px",
              padding: isTablet ? "16px 18px" : "10px 12px",
              backgroundColor: COLORS.cardBg,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: isTablet ? "16px" : "10px",
              fontSize: isTablet ? "16px" : "var(--fs-body)",
              color: COLORS.textSoft,
            }}
          >
            {saveStatus}
          </div>
        )}
      </div>

      {selectedUnblockConfirmationOpen && selectedOrder && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 41, 55, 0.28)",
            display: "grid",
            placeItems: "center",
            padding: isTablet ? "22px" : "20px",
            zIndex: 60,
          }}
          onMouseDown={closeSelectedUnblockConfirmation}
        >
          <div
            style={{
              width: "100%",
              maxWidth: isTablet ? "620px" : "520px",
              backgroundColor: "#fcfaf6",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: isTablet ? "24px" : "18px",
              boxShadow: "0 20px 50px rgba(31, 41, 55, 0.18)",
              padding: isTablet ? "22px" : "16px",
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div style={{ marginBottom: isTablet ? "12px" : "14px" }}>
              <div style={eyebrowStyle}>Confirm unblock</div>
              <h2
                style={{
                  margin: 0,
                  fontSize: isTablet ? "26px" : "var(--fs-title)",
                  fontWeight: isTablet ? 700 : 750,
                  letterSpacing: 0,
                  color: COLORS.text,
                  lineHeight: isTablet ? 1.15 : 1.1,
                }}
              >
                {`Unblock ${selectedOrder.work_order_id}?`}
              </h2>
            </div>

            <div
              style={{
                ...innerCard,
                backgroundColor: COLORS.panelBg,
                borderRadius: isTablet ? "18px" : "14px",
                padding: isTablet ? "18px" : "13px",
                display: "grid",
                gap: isTablet ? "14px" : "10px",
              }}
            >
              <div>
                <div style={eyebrowStyle}>Hold reason</div>
                <div style={{ fontSize: isTablet ? "17px" : "var(--fs-body)", color: COLORS.text }}>
                  {blockReason(selectedOrder, {
                    rfqSentLabel: RFQ_AWAITING_APPROVAL_REASON,
                  })}
                </div>
              </div>

              <StatusNote color="red" large={isTablet}>
                Are you sure you want to do this? This action cannot be reversed.
              </StatusNote>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: isTablet ? "14px" : "10px",
                marginTop: isTablet ? "18px" : "14px",
              }}
            >
              <button
                type="button"
                onClick={closeSelectedUnblockConfirmation}
                style={{
                  padding: isTablet ? "16px 20px" : "8px 12px",
                  borderRadius: isTablet ? "15px" : "10px",
                  border: `1px solid ${COLORS.borderStrong}`,
                  backgroundColor: COLORS.panelBg,
                  color: COLORS.text,
                  fontSize: isTablet ? "17px" : "var(--fs-body)",
                  fontWeight: 700,
                  cursor: "pointer",
                  minHeight: isTablet ? "58px" : undefined,
                }}
                disabled={isUnblockingSelected}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void unblockSelectedWorkOrder()}
                style={{
                  ...primaryBtn,
                  padding: isTablet ? "17px 24px" : "8px 12px",
                  borderRadius: isTablet ? "16px" : "10px",
                  boxShadow: "0 8px 20px rgba(37, 85, 199, 0.18)",
                }}
                disabled={isUnblockingSelected}
              >
                {isUnblockingSelected ? "Saving..." : "Unblock"}
              </button>
            </div>
          </div>
        </div>
      )}

      {extraActionToClose && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 41, 55, 0.28)",
            display: "grid",
            placeItems: "center",
            padding: isTablet ? "22px" : "24px",
            zIndex: 60,
          }}
          onMouseDown={closeCloseExtraActionConfirmation}
        >
          <div
            style={{
              width: "100%",
              maxWidth: isTablet ? "620px" : "480px",
              backgroundColor: "#fcfaf6",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: isTablet ? "24px" : "16px",
              boxShadow: "0 20px 50px rgba(31, 41, 55, 0.18)",
              padding: isTablet ? "22px" : "16px",
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div style={{ marginBottom: "12px" }}>
              <div style={eyebrowStyle}>Complete additional task</div>
              <h2
                style={{
                  margin: 0,
                  fontSize: isTablet ? "26px" : "var(--fs-title)",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: COLORS.text,
                  lineHeight: 1.15,
                }}
              >
                {extraActionToClose.description}
              </h2>
            </div>

            <div style={{ ...innerCard, display: "grid", gap: isTablet ? "14px" : "8px" }}>
              <div>
                <div style={eyebrowStyle}>Responsible</div>
                <div style={{ fontSize: isTablet ? "17px" : "var(--fs-body)", color: COLORS.text }}>
                  {normalizeAssignedPersonTeam(extraActionToClose.responsible_person_team)}
                </div>
              </div>
              <div>
                <div style={eyebrowStyle}>Due date</div>
                <div style={{ fontSize: isTablet ? "17px" : "var(--fs-body)", color: COLORS.text }}>
                  {formatDate(extraActionToClose.due_date)}
                </div>
              </div>

              <StatusNote color="red" large={isTablet}>
                This cannot be undone. The task will be permanently removed.
              </StatusNote>

              {extraActionCloseStatus && (
                <StatusNote
                  color={extraActionCloseStatus.startsWith("Error:") ? "red" : "neutral"}
                  large={isTablet}
                >
                  {extraActionCloseStatus}
                </StatusNote>
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: isTablet ? "14px" : "8px",
                marginTop: isTablet ? "18px" : "12px",
              }}
            >
              <button
                type="button"
                onClick={closeCloseExtraActionConfirmation}
                style={{
                  padding: isTablet ? "16px 20px" : "9px 14px",
                  borderRadius: isTablet ? "15px" : "8px",
                  border: `1px solid ${COLORS.borderStrong}`,
                  backgroundColor: COLORS.panelBg,
                  color: COLORS.text,
                  fontSize: isTablet ? "17px" : "var(--fs-body)",
                  fontWeight: 700,
                  cursor: "pointer",
                  minHeight: isTablet ? "58px" : undefined,
                }}
                disabled={isClosingExtraAction}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmCloseExtraAction()}
                style={primaryBtn}
                disabled={isClosingExtraAction}
              >
                Complete task
              </button>
            </div>
          </div>
        </div>
      )}

      {correctiveActionToClose && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 41, 55, 0.28)",
            display: "grid",
            placeItems: "center",
            padding: isTablet ? "22px" : "24px",
            zIndex: 60,
          }}
          onMouseDown={closeCloseCorrectiveActionConfirmation}
        >
          <div
            style={{
              width: "100%",
              maxWidth: isTablet ? "620px" : "480px",
              backgroundColor: "#fcfaf6",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: isTablet ? "24px" : "16px",
              boxShadow: "0 20px 50px rgba(31, 41, 55, 0.18)",
              padding: isTablet ? "22px" : "16px",
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div style={{ marginBottom: "12px" }}>
              <div style={eyebrowStyle}>Complete corrective action</div>
              <h2
                style={{
                  margin: 0,
                  fontSize: isTablet ? "26px" : "var(--fs-title)",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: COLORS.text,
                  lineHeight: 1.15,
                }}
              >
                {getCorrectiveActionContext(correctiveActionToClose).action || "-"}
              </h2>
            </div>

            <div style={{ ...innerCard, display: "grid", gap: isTablet ? "14px" : "8px" }}>
              <div>
                <div style={eyebrowStyle}>Work order</div>
                <div style={{ fontSize: isTablet ? "17px" : "var(--fs-body)", color: COLORS.text }}>
                  {correctiveActionToClose.work_order_id}
                </div>
              </div>
              <div>
                <div style={eyebrowStyle}>Responsible</div>
                <div style={{ fontSize: isTablet ? "17px" : "var(--fs-body)", color: COLORS.text }}>
                  {isRfqSendAction(correctiveActionToClose)
                    ? "-"
                    : normalizeAssignedPersonTeam(
                        getCorrectiveActionContext(correctiveActionToClose).owner,
                      )}
                </div>
              </div>
              <div>
                <div style={eyebrowStyle}>Due date</div>
                <div style={{ fontSize: isTablet ? "17px" : "var(--fs-body)", color: COLORS.text }}>
                  {formatDate(correctiveActionToClose.due_date)}
                </div>
              </div>

              {isRfqSendAction(correctiveActionToClose) ? (
                <>
                  <StatusNote color="neutral" large={isTablet}>
                    Before completing this action, confirm with Rens or Alissa
                    whether the shop may continue this work order.
                  </StatusNote>
                  <div>
                    <div style={eyebrowStyle}>After completion</div>
                    <div style={{ display: "flex", gap: isTablet ? "14px" : "8px" }}>
                      <button
                        type="button"
                        onClick={() => setRfqCloseMode("awaiting_approval")}
                        style={choiceBtn(rfqCloseMode === "awaiting_approval")}
                        disabled={isClosingCorrectiveAction}
                      >
                        No, wait for RFQ payment
                      </button>
                      <button
                        type="button"
                        onClick={() => setRfqCloseMode("continue")}
                        style={choiceBtn(rfqCloseMode === "continue")}
                        disabled={isClosingCorrectiveAction}
                      >
                        Yes, continue
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <StatusNote color="green" large={isTablet}>
                  Completing this action removes the block and puts the work order back on open.
                </StatusNote>
              )}

              {correctiveActionCloseStatus && (
                <StatusNote
                  color={correctiveActionCloseStatus.startsWith("Error:") ? "red" : "neutral"}
                  large={isTablet}
                >
                  {correctiveActionCloseStatus}
                </StatusNote>
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: isTablet ? "14px" : "8px",
                marginTop: isTablet ? "18px" : "12px",
              }}
            >
              <button
                type="button"
                onClick={closeCloseCorrectiveActionConfirmation}
                style={{
                  padding: isTablet ? "16px 20px" : "9px 14px",
                  borderRadius: isTablet ? "15px" : "8px",
                  border: `1px solid ${COLORS.borderStrong}`,
                  backgroundColor: COLORS.panelBg,
                  color: COLORS.text,
                  fontSize: isTablet ? "17px" : "var(--fs-body)",
                  fontWeight: 700,
                  cursor: "pointer",
                  minHeight: isTablet ? "58px" : undefined,
                }}
                disabled={isClosingCorrectiveAction}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmCloseCorrectiveAction()}
                style={primaryBtn}
                disabled={isClosingCorrectiveAction}
              >
                Complete action
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function InfoBox({
  label,
  value,
  large = false,
}: {
  label: string;
  value: string;
  large?: boolean;
}) {
  return (
    <div
      style={{
        padding: large ? "17px" : "10px 12px",
        backgroundColor: COLORS.cardBg,
        border: `1px solid ${COLORS.border}`,
        borderRadius: large ? "16px" : "10px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: large ? "12px" : "var(--fs-xs)",
          color: "#8b857a",
          marginBottom: "4px",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: large ? "17px" : "var(--fs-md)",
          fontWeight: 700,
          color: COLORS.text,
          lineHeight: 1.3,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StatusNote({
  children,
  color,
  large = false,
  style,
}: {
  children: React.ReactNode;
  color: "blue" | "green" | "red" | "neutral";
  large?: boolean;
  style?: CSSProperties;
}) {
  const palette = {
    blue: {
      backgroundColor: COLORS.blueSoft,
      border: "1px solid #d7e5ff",
      color: COLORS.blue,
    },
    green: {
      backgroundColor: COLORS.greenSoft,
      border: "1px solid #cdeedc",
      color: COLORS.green,
    },
    red: {
      backgroundColor: COLORS.redSoft,
      border: "1px solid #f0c9ba",
      color: COLORS.red,
    },
    neutral: {
      backgroundColor: COLORS.cardBg,
      border: `1px solid ${COLORS.border}`,
      color: COLORS.textSoft,
    },
  }[color];

  return (
    <div
      style={{
        marginTop: color === "red" || color === "neutral" ? 0 : large ? "16px" : "10px",
        padding: large ? "15px 16px" : "8px 10px",
        borderRadius: large ? "15px" : "8px",
        fontSize: large ? "16px" : "var(--fs-body)",
        fontWeight: 700,
        lineHeight: 1.45,
        ...palette,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
// noah was hier

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RequireRole } from "@/app/components/require-role";
import {
  getAbsentEngineerIdSetForDateKey,
  getEngineerAbsences,
  getEngineers,
} from "@/lib/engineers";
import { getWorkOrders, updateWorkOrderAndFetch } from "@/lib/work-orders";
import { createExtraAction } from "@/lib/extra-actions";
import {
  applySuggestedAssignmentsForCurrentStep,
  autoAssignForStep,
} from "@/lib/auto-assign";
import {
  INTAKE_STEP,
  getActiveStepsForType,
  getCompletableStepsForOrder,
  getInitialProcessStepForOrder,
  getProcessStepsForType,
} from "@/lib/process-steps";
import {
  DEFAULT_ASSIGNED_PERSON_TEAM,
  normalizeAssignedPersonTeam,
  normalizePriorityValue,
} from "@/lib/work-order-rules";
import { SearchableSelect } from "@/app/components/searchable-select";
import { PageHeader } from "@/app/components/page-header";
import {
  stopWorkOrderDataTracking,
  syncWorkOrderDataBlockState,
} from "@/lib/work-order-data";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  due_date: string | null;
  priority: string | null;
  assigned_person_team: string | null;
  hold_reason: string | null;
  rfq_state: string | null;
  required_next_action: string | null;
  action_owner: string | null;
  action_status: string | null;
  action_closed: boolean | null;
  is_active: boolean;
  work_order_type: string | null;
  current_process_step: string | null;
  part_number: string | null;
  included_process_steps: string[] | null;
  data_tracking_enabled: boolean | null;
};

type StepVariant = "standard" | "custom";

type StaffMember = {
  id: number;
  name: string;
  role: string | null;
  restrictions: string[] | null;
  employment_start_date?: string | null;
};

type FormState = {
  due_date: string;
  priority: string;
  assigned_person_team: string;
  hold_reason: string;
  required_next_action: string;
  action_owner: string;
  activation_process_step: string;
  is_active: boolean;
  step_variant: StepVariant;
  included_steps: string[];
};

type ExtraActionFormState = {
  description: string;
  responsible_person_team: string;
  due_date: string;
};

type Mode = "active" | "inactive" | null;

const EMPTY_FORM: FormState = {
  due_date: "",
  priority: "No",
  assigned_person_team: "",
  hold_reason: "",
  required_next_action: "",
  action_owner: "",
  activation_process_step: "",
  is_active: true,
  step_variant: "standard",
  included_steps: [],
};

function defaultIncludedStepsForType(workOrderType: string | null): string[] {
  return getActiveStepsForType(workOrderType, false);
}

function normalizeIncludedSteps(
  workOrderType: string | null,
  selected: string[],
): string[] {
  const template = getProcessStepsForType(workOrderType);
  if (template.length === 0) return [];
  const selectedSet = new Set(selected);
  return template.filter(
    (step) => selectedSet.has(step) || step === INTAKE_STEP,
  );
}

function inferVariantFromSteps(
  workOrderType: string | null,
  includedSteps: string[] | null,
): StepVariant {
  if (!includedSteps || includedSteps.length === 0) return "standard";
  const defaults = defaultIncludedStepsForType(workOrderType);
  if (defaults.length !== includedSteps.length) return "custom";
  const defaultSet = new Set(defaults);
  return includedSteps.every((step) => defaultSet.has(step))
    ? "standard"
    : "custom";
}

function getStandardVariantLabel(workOrderType: string | null): string {
  if (workOrderType === "Battery") return "Standard Battery";
  if (workOrderType?.includes("Overhaul")) return "Standard Overhaul";
  if (workOrderType?.includes("Repair")) return "Standard Repair";
  return "Standard";
}

const EMPTY_EXTRA_ACTION_FORM: ExtraActionFormState = {
  description: "",
  responsible_person_team: "",
  due_date: "",
};

type Absence = {
  engineer_id: number;
  absence_date: string;
};

const WORK_ORDER_SELECT =
  "work_order_id, customer, due_date, priority, assigned_person_team, hold_reason, rfq_state, required_next_action, action_owner, action_status, action_closed, is_active, work_order_type, current_process_step, part_number, included_process_steps, data_tracking_enabled";

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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
  amber: "#b45309",
  amberSoft: "#fff6e8",
  red: "#b42318",
  redSoft: "#fff2ef",
  inputBg: "#fffdf9",
  shadow: "0 1px 2px rgba(31, 41, 55, 0.04), 0 4px 12px rgba(31, 41, 55, 0.04)",
};

const FONT_STACK = 'var(--font-inter), var(--font-geist-sans), sans-serif';
const MAJOR_SECTION_GAP = "44px";

function OfficeUpdatePageContent() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [shopStaff, setShopStaff] = useState<StaffMember[]>([]);
  const [officeStaff, setOfficeStaff] = useState<StaffMember[]>([]);
  const [todayAbsentEngineerIds, setTodayAbsentEngineerIds] = useState<number[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [extraActionForm, setExtraActionForm] = useState<ExtraActionFormState>(
    EMPTY_EXTRA_ACTION_FORM,
  );
  const [isBlockedUpdate, setIsBlockedUpdate] = useState(false);
  const [showInactiveActivationForm, setShowInactiveActivationForm] = useState(false);
  const [showDeactivateWarning, setShowDeactivateWarning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const [extraActionStatus, setExtraActionStatus] = useState("");

  const buildFormFromOrder = useCallback((order: WorkOrder): FormState => {
    const storedAssignedPersonTeam = order.assigned_person_team?.trim() || "";
    const assignedPersonTeam =
      storedAssignedPersonTeam === DEFAULT_ASSIGNED_PERSON_TEAM
        ? ""
        : storedAssignedPersonTeam;

    const includedSteps =
      order.included_process_steps && order.included_process_steps.length > 0
        ? order.included_process_steps
        : defaultIncludedStepsForType(order.work_order_type);
    const variant = inferVariantFromSteps(
      order.work_order_type,
      order.included_process_steps,
    );

    return {
      due_date: order.is_active ? order.due_date || "" : "",
      priority: order.is_active ? order.priority || "No" : "",
      assigned_person_team: order.is_active ? assignedPersonTeam : "",
      hold_reason: order.hold_reason || "",
      required_next_action: order.hold_reason?.trim()
        ? order.required_next_action || ""
        : "",
      action_owner: order.hold_reason?.trim() ? order.action_owner || "" : "",
      activation_process_step:
        order.current_process_step?.trim() ||
        getInitialProcessStepForOrder(order.work_order_type, includedSteps),
      is_active: order.is_active,
      step_variant: variant,
      included_steps: includedSteps,
    };
  }, []);

  const applyOrderSelection = useCallback(
    (order: WorkOrder) => {
      setSelectedId(order.work_order_id);
      setForm(buildFormFromOrder(order));
      setIsBlockedUpdate(Boolean(order.hold_reason?.trim()));
      setShowInactiveActivationForm(false);
      setShowDeactivateWarning(false);
      setSaveStatus("");
    },
    [buildFormFromOrder],
  );

  useEffect(() => {
    async function load() {
      const today = localDateKey();
      const [wo, staffData, absenceData] = await Promise.all([
        getWorkOrders<WorkOrder>({
          select: WORK_ORDER_SELECT,
          isOpen: true,
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
      ]);

      setShopStaff(staffData.filter((s) => s.role === "shop"));
      setOfficeStaff(staffData.filter((s) => s.role === "office"));
      setTodayAbsentEngineerIds(
        Array.from(getAbsentEngineerIdSetForDateKey(absenceData, today)),
      );
      setOrders(
        applySuggestedAssignmentsForCurrentStep(
          wo,
          staffData.filter((staffMember) => staffMember.role === "shop"),
          new Set(
            staffData
              .filter(
                (staffMember) =>
                  staffMember.role === "shop" &&
                  absenceData.some(
                    (absence) =>
                      absence.absence_date === today &&
                      absence.engineer_id === staffMember.id,
                  ),
              )
              .map((staffMember) => staffMember.name),
          ),
        ),
      );
      setLoading(false);

      const woParam = new URLSearchParams(window.location.search).get("wo");
      if (woParam) {
        const order = wo.find((o) => o.work_order_id === woParam);
        if (order) {
          setMode(order.is_active ? "active" : "inactive");
          applyOrderSelection(order);
        }
      }
    }

    void load();
  }, [applyOrderSelection]);

  const activeOrders = useMemo(
    () => orders.filter((o) => o.is_active),
    [orders],
  );

  const inactiveOrders = useMemo(
    () => orders.filter((o) => !o.is_active),
    [orders],
  );

  const visibleOrders = useMemo(() => {
    if (mode === "active") return activeOrders;
    if (mode === "inactive") return inactiveOrders;
    return [];
  }, [mode, activeOrders, inactiveOrders]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.work_order_id === selectedId),
    [orders, selectedId],
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

  const dueDateRequired = form.priority === "Yes" || form.priority === "AOG";
  const inactiveActivationStepOptions = useMemo(
    () =>
      selectedOrder
        ? getCompletableStepsForOrder(
            selectedOrder.work_order_type,
            form.included_steps,
          )
        : [],
    [selectedOrder, form.included_steps],
  );

  function displayDate(value: string | null): string {
    if (!value) return "—";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-GB");
  }

  function aogPrioritySuffix(order: WorkOrder): string {
    return order.priority === "AOG" ? " — AOG" : "";
  }

  function clearPageAfterSave() {
    setMode(null);
    setSelectedId("");
    setForm(EMPTY_FORM);
    setIsBlockedUpdate(false);
    setShowInactiveActivationForm(false);
    setShowDeactivateWarning(false);
  }

  function selectOrder(id: string) {
    const order = orders.find((o) => o.work_order_id === id);
    if (!order) return;
    applyOrderSelection(order);
  }

  function changeMode(nextMode: "active" | "inactive") {
    setMode(nextMode);
    setSelectedId("");
    setForm(EMPTY_FORM);
    setIsBlockedUpdate(false);
    setShowInactiveActivationForm(false);
    setShowDeactivateWarning(false);
    setSaveStatus("");
  }

  function startInactiveActivation() {
    if (!selectedOrder || selectedOrder.is_active) return;

    setForm((prev) => ({
      ...prev,
      is_active: true,
    }));
    setShowInactiveActivationForm(true);
    setShowDeactivateWarning(false);
    setSaveStatus("");
  }

  function startDeactivateFlow() {
    if (!selectedOrder || !selectedOrder.is_active) return;
    setShowDeactivateWarning(true);
    setSaveStatus("");
  }

  function confirmDeactivate() {
    setForm((prev) => ({
      ...prev,
      is_active: false,
    }));
    setShowDeactivateWarning(false);
    setSaveStatus("");
  }

  function undoDeactivate() {
    setForm((prev) => ({
      ...prev,
      is_active: true,
    }));
    setShowDeactivateWarning(false);
    setSaveStatus("");
  }

  function setBlockedChoice(blocked: boolean) {
    setIsBlockedUpdate(blocked);

    if (!blocked) {
      setForm((prev) => ({
        ...prev,
        hold_reason: "",
        required_next_action: "",
        action_owner: "",
      }));
    }
  }

  async function saveWorkOrder() {
    if (!selectedId || !selectedOrder) return;

    if (dueDateRequired && !form.due_date) {
      setSaveStatus("Due Date is required when Priority is Yes or AOG.");
      return;
    }

    if (isBlockedUpdate && !form.hold_reason.trim()) {
      setSaveStatus("Please enter a hold reason.");
      return;
    }

    if (todayAbsentShopEngineerNames.has(form.assigned_person_team)) {
      setSaveStatus(
        `${form.assigned_person_team} is absent today. Choose another engineer or Shop (default).`,
      );
      return;
    }

    if (todayAbsentShopEngineerNames.has(form.action_owner)) {
      setSaveStatus(
        `${form.action_owner} is absent today. Choose another owner.`,
      );
      return;
    }

    const normalizedAssigned = normalizeAssignedPersonTeam(
      form.assigned_person_team,
    );
    const normalizedPriority = normalizePriorityValue(form.priority);
    const normalizedHoldReason = form.hold_reason.trim();
    const normalizedRequiredAction = form.required_next_action.trim();
    const normalizedActionOwner = form.action_owner.trim();

    setSaveStatus("Saving...");

    const isActivating = !selectedOrder.is_active && form.is_active;
    const isDeactivating = selectedOrder.is_active && !form.is_active;
    const preservedStep = selectedOrder.current_process_step?.trim() || "";
    const normalizedIncludedSteps = normalizeIncludedSteps(
      selectedOrder.work_order_type,
      form.included_steps,
    );
    const includedStepsForSave =
      normalizedIncludedSteps.length > 0 ? normalizedIncludedSteps : null;
    const nextProcessStep =
      (isActivating ? form.activation_process_step.trim() : "") ||
      preservedStep ||
      getInitialProcessStepForOrder(
        selectedOrder.work_order_type,
        includedStepsForSave,
      );

    const payload = {
      due_date: form.due_date || null,
      priority: normalizedPriority,
      assigned_person_team: isActivating
        ? autoAssignForStep(
            normalizedAssigned,
            nextProcessStep,
            shopStaff,
            todayAbsentShopEngineerNames,
          )
        : form.is_active
          ? normalizedAssigned
          : null,
      hold_reason: isBlockedUpdate ? normalizedHoldReason : null,
      required_next_action:
        isBlockedUpdate && normalizedRequiredAction
          ? normalizedRequiredAction
          : null,
      action_owner:
        isBlockedUpdate && normalizedActionOwner ? normalizedActionOwner : null,
      action_status: isBlockedUpdate ? "Open" : null,
      action_closed: false,
      is_active: form.is_active,
      current_process_step: isActivating ? nextProcessStep : selectedOrder.current_process_step,
      included_process_steps: isActivating
        ? includedStepsForSave
        : selectedOrder.included_process_steps,
      last_manual_update: new Date().toISOString(),
    };

    const { data: savedOrder, error } = await updateWorkOrderAndFetch<WorkOrder>(
      selectedId,
      payload,
      WORK_ORDER_SELECT,
    );

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    if (isDeactivating) {
      const trackingResult = await stopWorkOrderDataTracking(selectedId);
      if (trackingResult.error) {
        console.error(
          `Failed to stop Work Order Data tracking for ${selectedId}: ${trackingResult.error.message}`,
        );
      }
    } else if (savedOrder) {
      const blockResult = await syncWorkOrderDataBlockState(savedOrder);
      if (blockResult.error) {
        console.error(
          `Failed to sync Work Order Data block state for ${savedOrder.work_order_id}: ${blockResult.error.message}`,
        );
      }
    }

    setOrders((prev) =>
      prev.map((o) =>
        o.work_order_id === selectedId && savedOrder ? savedOrder : o,
      ),
    );

    clearPageAfterSave();
    setSaveStatus("Saved.");
  }

  async function saveExtraAction() {
    const normalizedDescription = extraActionForm.description.trim();

    if (!normalizedDescription) {
      setExtraActionStatus("Please enter a description.");
      return;
    }

    if (todayAbsentShopEngineerNames.has(extraActionForm.responsible_person_team)) {
      setExtraActionStatus(
        `${extraActionForm.responsible_person_team} is absent today. Choose another engineer or Shop (default).`,
      );
      return;
    }

    setExtraActionStatus("Saving...");

    const { error } = await createExtraAction({
      description: normalizedDescription,
      responsible_person_team: normalizeAssignedPersonTeam(
        extraActionForm.responsible_person_team,
      ),
      due_date: extraActionForm.due_date || null,
    });

    if (error) {
      setExtraActionStatus(`Error: ${error.message}`);
      return;
    }

    setExtraActionForm(EMPTY_EXTRA_ACTION_FORM);
    setExtraActionStatus("Extra action saved.");
  }

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: COLORS.pageBg,
          padding: "var(--layout-page-py) var(--layout-page-px) var(--layout-page-px)",
          color: COLORS.textSoft,
          fontFamily: FONT_STACK,
        }}
      >
        Loading...
      </div>
    );
  }

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    backgroundColor: COLORS.pageBg,
    padding: "var(--layout-page-py) var(--layout-page-px) var(--layout-page-px)",
    fontFamily: FONT_STACK,
    color: COLORS.text,
  };

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: "var(--layout-content-max-w)",
    marginInline: "auto",
  };

  const sectionCard: React.CSSProperties = {
    backgroundColor: COLORS.panelBg,
    borderStyle: "solid",
    borderTopWidth: "1px",
    borderRightWidth: "1px",
    borderBottomWidth: "1px",
    borderLeftWidth: "1px",
    borderColor: COLORS.border,
    borderTopLeftRadius: "var(--card-radius)",
    borderTopRightRadius: "var(--card-radius)",
    borderBottomRightRadius: "var(--card-radius)",
    borderBottomLeftRadius: "var(--card-radius)",
    padding: "var(--card-py) var(--card-px)",
    boxShadow: COLORS.shadow,
    minWidth: 0,
  };

  const innerCard: React.CSSProperties = {
    backgroundColor: COLORS.cardBg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "var(--card-radius)",
    padding: "12px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: "8px",
    fontSize: "var(--fs-body)",
    boxSizing: "border-box",
    backgroundColor: COLORS.inputBg,
    color: COLORS.text,
    minHeight: "36px",
    outline: "none",
  };

  const fieldTitleStyle: React.CSSProperties = {
    fontSize: "var(--fs-title)",
    fontWeight: 650,
    color: COLORS.heading,
    margin: 0,
    letterSpacing: "-0.015em",
  };

  const eyebrowStyle: React.CSSProperties = {
    fontSize: "var(--fs-xs)",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: COLORS.textMuted,
    marginBottom: "4px",
  };

  const modeBtn = (
    kind: "active" | "inactive",
    active: boolean,
  ): React.CSSProperties => ({
    padding: "8px 14px",
    borderRadius: "8px",
    border: `1px solid ${active ? (kind === "active" ? "#d7e3ff" : "#ead1a6") : COLORS.border}`,
    backgroundColor: active
      ? kind === "active"
        ? COLORS.blueSoft
        : COLORS.amberSoft
      : COLORS.panelBg,
    color: active ? (kind === "active" ? COLORS.blue : COLORS.amber) : COLORS.textSoft,
    fontWeight: 700,
    fontSize: "var(--fs-sm)",
    cursor: "pointer",
    boxShadow: active ? "0 1px 2px rgba(31, 41, 55, 0.04)" : "none",
  });

  const choiceBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "8px 10px",
    borderRadius: "8px",
    border: `1px solid ${active ? "#d7e3ff" : COLORS.border}`,
    backgroundColor: active ? COLORS.blueSoft : COLORS.panelBg,
    color: active ? COLORS.blue : COLORS.textSoft,
    fontWeight: 700,
    fontSize: "var(--fs-sm)",
    cursor: "pointer",
  });

  const primaryBtn: React.CSSProperties = {
    padding: "9px 16px",
    backgroundColor: COLORS.blue,
    color: "white",
    border: `1px solid ${COLORS.blue}`,
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "var(--fs-body)",
    boxShadow: "0 6px 16px rgba(37, 85, 199, 0.16)",
  };

  const secondaryBtn: React.CSSProperties = {
    padding: "9px 16px",
    backgroundColor: COLORS.panelBg,
    color: COLORS.textSoft,
    border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "var(--fs-body)",
  };

  const showEditor = selectedOrder
    ? selectedOrder.is_active || showInactiveActivationForm
    : false;

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <PageHeader
          title="Office Update"
          description="Manage work order planning, add additional tasks when a work order is blocked, and activate or deactivate work orders as needed."
        />

        <section
          style={{
            ...sectionCard,
            marginTop: "14px",
            ...(mode
              ? {
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                  borderBottomWidth: 0,
                  boxShadow: "none",
                }
              : null),
          }}
        >
          <h2 style={{ ...fieldTitleStyle, marginBottom: "4px" }}>
            Work orders
          </h2>
          <div
            style={{
              fontSize: "var(--fs-body)",
              lineHeight: 1.5,
              color: COLORS.textSoft,
              marginBottom: "12px",
            }}
          >
            Choose whether you want to work with active or inactive work orders.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "12px",
            }}
          >
            <div style={innerCard}>
              <h2 style={{ ...fieldTitleStyle, marginBottom: "4px" }}>
                Active work orders
              </h2>
              <div
                style={{
                  fontSize: "var(--fs-body)",
                  lineHeight: 1.5,
                  color: COLORS.textSoft,
                  marginBottom: "10px",
                }}
              >
                Open the update flow for work orders that are currently active in the shop.
              </div>
              <button
                type="button"
                onClick={() => changeMode("active")}
                style={modeBtn("active", mode === "active")}
              >
                Active ({activeOrders.length})
              </button>
            </div>

            <div style={innerCard}>
              <h2 style={{ ...fieldTitleStyle, marginBottom: "4px" }}>
                Inactive work orders
              </h2>
              <div
                style={{
                  fontSize: "var(--fs-body)",
                  lineHeight: 1.5,
                  color: COLORS.textSoft,
                  marginBottom: "10px",
                }}
              >
                Review inactive work orders and activate them again when they are ready to work on.
              </div>
              <button
                type="button"
                onClick={() => changeMode("inactive")}
                style={modeBtn("inactive", mode === "inactive")}
              >
                Inactive ({inactiveOrders.length})
              </button>
            </div>
          </div>
        </section>

        {mode && (
          <section
            style={{
              ...sectionCard,
              marginTop: 0,
              borderTopWidth: 0,
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
              ...(selectedOrder
                ? {
                    borderBottomLeftRadius: 0,
                    borderBottomRightRadius: 0,
                    borderBottomWidth: 0,
                    boxShadow: "none",
                  }
                : null),
            }}
          >
            <div
              style={{
                height: "1px",
                backgroundColor: COLORS.border,
                margin: "0 12px 16px",
              }}
            />
            <h2
              style={{ ...fieldTitleStyle, marginBottom: "4px" }}
            >
              {mode === "active"
                ? "Select active work order"
                : "Select inactive work order"}
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.65fr) minmax(0, 1fr)",
                gap: "var(--gap-default)",
              }}
            >
              <div style={innerCard}>
                <div style={eyebrowStyle}>Search</div>
                <SearchableSelect
                  options={visibleOrders.map((o) => ({
                    value: o.work_order_id,
                    label: `${o.work_order_id} — ${o.customer || "No customer"} — ${o.part_number || "No PN"} — ${o.work_order_type || "Unknown type"}${aogPrioritySuffix(o)}`,
                  }))}
                  value={selectedId}
                  onChange={(v) => selectOrder(v)}
                  placeholder="Search by work order, customer or part number..."
                  style={{ marginTop: "2px" }}
                />
              </div>

              <div style={innerCard}>
                <div style={eyebrowStyle}>Browse list</div>
                <select
                  value={selectedId}
                  onChange={(e) => selectOrder(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select from list...</option>
                  {visibleOrders.map((o) => (
                    <option key={o.work_order_id} value={o.work_order_id}>
                      {o.work_order_id} — {o.customer || "No customer"} —{" "}
                      {o.part_number || "No PN"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        )}

        {selectedOrder && (
          <>
            <section
              style={{
                ...sectionCard,
                marginTop: 0,
                borderTopWidth: 0,
                borderTopLeftRadius: 0,
                borderTopRightRadius: 0,
                boxShadow: "none",
                ...(showEditor
                  ? {
                      borderBottomLeftRadius: 0,
                      borderBottomRightRadius: 0,
                      borderBottomWidth: 0,
                    }
                  : null),
              }}
            >
              <div
                style={{
                  height: "1px",
                  backgroundColor: COLORS.border,
                  margin: "0 12px 16px",
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  marginBottom: "12px",
                }}
              >
                <h2 style={fieldTitleStyle}>Details</h2>
                {!selectedOrder.is_active && !showEditor && (
                  <button
                    type="button"
                    onClick={startInactiveActivation}
                    style={primaryBtn}
                  >
                    Activate Work Order
                  </button>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                  gap: "10px",
                }}
              >
                <InfoBox label="Work Order" value={selectedOrder.work_order_id} />
                <InfoBox label="Customer" value={selectedOrder.customer || "—"} />
                <InfoBox label="Part Number" value={selectedOrder.part_number || "—"} />
                <InfoBox
                  label="Work Order Type"
                  value={selectedOrder.work_order_type || "—"}
                />
                <InfoBox
                  label="Current Step"
                  value={selectedOrder.current_process_step || "—"}
                />
                <InfoBox label="Due Date" value={displayDate(selectedOrder.due_date)} />
                <InfoBox
                  label="Assigned"
                  value={
                    selectedOrder.is_active
                      ? normalizeAssignedPersonTeam(selectedOrder.assigned_person_team)
                      : "—"
                  }
                />
                <InfoBox
                  label="Priority"
                  value={selectedOrder.is_active ? selectedOrder.priority || "—" : "—"}
                />
              </div>
            </section>

            {showEditor && (
              <>
                <section
                  style={{
                    ...sectionCard,
                    marginTop: 0,
                    borderTopWidth: 0,
                    borderTopLeftRadius: 0,
                    borderTopRightRadius: 0,
                  }}
                >
                  <div
                    style={{
                      height: "1px",
                      backgroundColor: COLORS.border,
                      margin: "0 12px 16px",
                    }}
                  />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr)",
                      gap: "12px",
                    }}
                  >
                    <div style={{ ...sectionCard, display: "flex", flexDirection: "column" }}>
                      <h2
                        style={{
                          ...fieldTitleStyle,
                          marginBottom: "4px",
                        }}
                      >
                        Planning details
                      </h2>
                      <div style={{ display: "grid", gap: "10px" }}>
                        <div>
                          <div style={eyebrowStyle}>Due Date</div>
                          <input
                            type="date"
                            value={form.due_date}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                due_date: e.target.value,
                              }))
                            }
                            style={{
                              ...inputStyle,
                              borderColor:
                                dueDateRequired && !form.due_date
                                  ? "#c2410c"
                                  : COLORS.borderStrong,
                            }}
                          />
                          {dueDateRequired && !form.due_date && (
                            <div
                              style={{
                                marginTop: "6px",
                                fontSize: "12px",
                                color: COLORS.red,
                                fontWeight: 700,
                              }}
                            >
                              Due Date is required for Priority or AOG.
                            </div>
                          )}
                        </div>

                        <div>
                          <div style={eyebrowStyle}>Priority</div>
                          <select
                            value={form.priority}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                priority: e.target.value,
                              }))
                            }
                            style={inputStyle}
                          >
                            {!selectedOrder.is_active && (
                              <option value="">Select priority...</option>
                            )}
                            <option value="No">No</option>
                            <option value="Yes">PRIO</option>
                            <option value="AOG">AOG</option>
                          </select>
                        </div>

                        <div>
                          <div style={eyebrowStyle}>Assigned Person / Team</div>
                          <select
                            value={form.assigned_person_team}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                assigned_person_team: e.target.value,
                              }))
                            }
                            style={inputStyle}
                          >
                            <option value="">Shop (default)</option>
                            {shopStaff.map((s) => (
                              <option
                                key={s.id}
                                value={s.name}
                                disabled={todayAbsentEngineerIdSet.has(s.id)}
                              >
                                {s.name}
                                {todayAbsentEngineerIdSet.has(s.id)
                                  ? " (absent today)"
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {selectedOrder.is_active && (
                      <div style={{ ...sectionCard, display: "flex", flexDirection: "column" }}>
                        <h2
                          style={{
                            ...fieldTitleStyle,
                            marginBottom: "4px",
                          }}
                        >
                          Blocked?
                        </h2>
                        <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
                          <button
                            type="button"
                            onClick={() => setBlockedChoice(false)}
                            style={choiceBtn(!isBlockedUpdate)}
                          >
                            No
                          </button>
                          <button
                            type="button"
                            onClick={() => setBlockedChoice(true)}
                            style={choiceBtn(isBlockedUpdate)}
                          >
                            Yes
                          </button>
                        </div>

                        {isBlockedUpdate ? (
                          <div
                            style={{
                              display: "grid",
                              gap: "8px",
                              padding: "12px",
                              backgroundColor: "#fffdfa",
                              border: `1px solid ${COLORS.border}`,
                              borderRadius: "10px",
                            }}
                          >
                            <div>
                              <div style={eyebrowStyle}>Hold Reason</div>
                              <input
                                value={form.hold_reason}
                                onChange={(e) =>
                                  setForm((prev) => ({
                                    ...prev,
                                    hold_reason: e.target.value,
                                  }))
                                }
                                placeholder="For example: awaiting customer approval..."
                                style={inputStyle}
                              />
                            </div>

                            <div>
                              <div style={eyebrowStyle}>Action Required</div>
                              <input
                                value={form.required_next_action}
                                onChange={(e) =>
                                  setForm((prev) => ({
                                    ...prev,
                                    required_next_action: e.target.value,
                                  }))
                                }
                                placeholder="What needs to happen?"
                                style={inputStyle}
                              />
                            </div>

                            <div>
                              <div style={eyebrowStyle}>Action Owner</div>
                              <select
                                value={form.action_owner}
                                onChange={(e) =>
                                  setForm((prev) => ({
                                    ...prev,
                                    action_owner: e.target.value,
                                  }))
                                }
                                style={inputStyle}
                              >
                                <option value="">Select owner...</option>
                                {officeStaff.length > 0 && (
                                  <optgroup label="Office">
                                    {officeStaff.map((s) => (
                                      <option key={s.id} value={s.name}>
                                        {s.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {shopStaff.length > 0 && (
                                    <optgroup label="Shop">
                                      {shopStaff.map((s) => (
                                      <option
                                        key={s.id}
                                        value={s.name}
                                        disabled={todayAbsentEngineerIdSet.has(s.id)}
                                      >
                                        {s.name}
                                        {todayAbsentEngineerIdSet.has(s.id)
                                          ? " (absent today)"
                                          : ""}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                              </select>
                            </div>

                            <div
                              style={{
                                fontSize: "var(--fs-sm)",
                                color: COLORS.textSoft,
                              }}
                            >
                              Status will be saved as <strong>Open</strong>.
                            </div>
                          </div>
                        ) : (
                          <div
                            style={{
                              padding: "10px 12px",
                              borderRadius: "10px",
                              backgroundColor: COLORS.greenSoft,
                              border: "1px solid #cdeedc",
                              color: COLORS.green,
                              fontWeight: 700,
                              fontSize: "var(--fs-body)",
                            }}
                          >
                            No corrective action is currently set.
                          </div>
                        )}
                      </div>
                    )}

                    <div
                      style={{
                        ...sectionCard,
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <h2
                        style={{
                          ...fieldTitleStyle,
                          marginBottom: "4px",
                        }}
                      >
                        Work Order details
                      </h2>
                      {selectedOrder.is_active && (
                        <div style={{ display: "grid", gap: "10px", marginBottom: "10px" }}>
                          {form.is_active ? (
                            <>
                              <button
                                type="button"
                                onClick={startDeactivateFlow}
                                style={{
                                  ...secondaryBtn,
                                  width: "100%",
                                  justifyContent: "center",
                                  borderColor: "#e8c98f",
                                  backgroundColor: COLORS.amberSoft,
                                  color: COLORS.amber,
                                }}
                              >
                                Make this work order inactive
                              </button>
                              {showDeactivateWarning && (
                                <div
                                  style={{
                                    display: "grid",
                                    gap: "10px",
                                    padding: "12px",
                                    backgroundColor: "#fffdfa",
                                    border: "1px solid #e8c98f",
                                    borderRadius: "10px",
                                  }}
                                >
                                  <div style={eyebrowStyle}>Warning</div>
                                  <div
                                    style={{
                                      color: COLORS.text,
                                      fontSize: "var(--fs-body)",
                                      lineHeight: 1.5,
                                    }}
                                  >
                                    This will remove the work order from the active shop list after
                                    saving. Make sure no one is still working on it.
                                  </div>
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "flex-end",
                                      gap: "8px",
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => setShowDeactivateWarning(false)}
                                      style={secondaryBtn}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={confirmDeactivate}
                                      style={{
                                        ...primaryBtn,
                                        backgroundColor: COLORS.amber,
                                        borderColor: COLORS.amber,
                                        boxShadow: "0 6px 16px rgba(180, 83, 9, 0.16)",
                                      }}
                                    >
                                      Confirm inactive
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <div
                              style={{
                                display: "grid",
                                gap: "10px",
                                padding: "12px",
                                backgroundColor: COLORS.amberSoft,
                                border: "1px solid #e8c98f",
                                borderRadius: "10px",
                              }}
                            >
                              <div
                                style={{
                                  color: COLORS.amber,
                                  fontWeight: 700,
                                  fontSize: "var(--fs-body)",
                                  lineHeight: 1.5,
                                }}
                              >
                                This work order is set to move to Inactive after saving.
                              </div>
                              <div>
                                <button
                                  type="button"
                                  onClick={undoDeactivate}
                                  style={secondaryBtn}
                                >
                                  Keep this work order active
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {!selectedOrder.is_active && (
                        <>
                          <div style={{ marginBottom: "10px" }}>
                            <div style={eyebrowStyle}>Process step setup</div>
                            <div
                              style={{
                                display: "flex",
                                gap: "6px",
                                marginTop: "4px",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  const defaults = defaultIncludedStepsForType(
                                    selectedOrder.work_order_type,
                                  );
                                  setForm((prev) => ({
                                    ...prev,
                                    step_variant: "standard",
                                    included_steps: defaults,
                                    activation_process_step:
                                      defaults.filter(
                                        (step) => step !== INTAKE_STEP,
                                      )[0] || prev.activation_process_step,
                                  }));
                                }}
                                style={{
                                  flex: 1,
                                  padding: "8px 12px",
                                  borderRadius: "8px",
                                  border: `1px solid ${form.step_variant === "standard" ? "#d7e3ff" : COLORS.border}`,
                                  backgroundColor:
                                    form.step_variant === "standard"
                                      ? COLORS.blueSoft
                                      : COLORS.panelBg,
                                  color:
                                    form.step_variant === "standard"
                                      ? COLORS.blue
                                      : COLORS.textSoft,
                                  fontWeight: 700,
                                  fontSize: "var(--fs-sm)",
                                  cursor: "pointer",
                                }}
                              >
                                {getStandardVariantLabel(
                                  selectedOrder.work_order_type,
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setForm((prev) => ({
                                    ...prev,
                                    step_variant: "custom",
                                  }))
                                }
                                style={{
                                  flex: 1,
                                  padding: "8px 12px",
                                  borderRadius: "8px",
                                  border: `1px solid ${form.step_variant === "custom" ? "#ead1a6" : COLORS.border}`,
                                  backgroundColor:
                                    form.step_variant === "custom"
                                      ? COLORS.amberSoft
                                      : COLORS.panelBg,
                                  color:
                                    form.step_variant === "custom"
                                      ? COLORS.amber
                                      : COLORS.textSoft,
                                  fontWeight: 700,
                                  fontSize: "var(--fs-sm)",
                                  cursor: "pointer",
                                }}
                              >
                                Custom
                              </button>
                            </div>
                          </div>

                          {form.step_variant === "custom" && (
                            <div
                              style={{
                                display: "grid",
                                gap: "4px",
                                padding: "10px",
                                backgroundColor: "#fffdfa",
                                border: `1px solid ${COLORS.border}`,
                                borderRadius: "10px",
                                marginBottom: "10px",
                              }}
                            >
                              {getProcessStepsForType(
                                selectedOrder.work_order_type,
                              )
                                .filter((step) => step !== INTAKE_STEP)
                                .map((step) => {
                                  const checked = form.included_steps.includes(
                                    step,
                                  );
                                  return (
                                    <label
                                      key={step}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        fontSize: "var(--fs-sm)",
                                        color: COLORS.text,
                                        cursor: "pointer",
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          const next = new Set(
                                            form.included_steps,
                                          );
                                          if (e.target.checked) next.add(step);
                                          else next.delete(step);
                                          const normalized = normalizeIncludedSteps(
                                            selectedOrder.work_order_type,
                                            Array.from(next),
                                          );
                                          setForm((prev) => {
                                            const firstCompletable =
                                              normalized.filter(
                                                (s) => s !== INTAKE_STEP,
                                              )[0] || "";
                                            const activationStepStillValid =
                                              normalized.includes(
                                                prev.activation_process_step,
                                              );
                                            return {
                                              ...prev,
                                              included_steps: normalized,
                                              activation_process_step:
                                                activationStepStillValid
                                                  ? prev.activation_process_step
                                                  : firstCompletable,
                                            };
                                          });
                                        }}
                                      />
                                      {step}
                                    </label>
                                  );
                                })}
                            </div>
                          )}

                          <div style={{ marginBottom: "10px" }}>
                            <div style={eyebrowStyle}>Next Process Step On Activation</div>
                            <select
                              value={form.activation_process_step}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  activation_process_step: e.target.value,
                                }))
                              }
                              style={inputStyle}
                            >
                              {inactiveActivationStepOptions.map((step) => (
                                <option key={step} value={step}>
                                  {step}
                                </option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}
                      {(!selectedOrder.is_active || !form.is_active) && (
                        <div
                          style={{
                            marginTop: "10px",
                            padding: "10px 12px",
                            borderRadius: "10px",
                            backgroundColor:
                              selectedOrder.is_active && !form.is_active
                                ? COLORS.amberSoft
                                : COLORS.blueSoft,
                            border:
                              selectedOrder.is_active && !form.is_active
                                ? "1px solid #e8c98f"
                                : "1px solid #d7e5ff",
                            color:
                              selectedOrder.is_active && !form.is_active
                                ? COLORS.amber
                                : COLORS.blue,
                            fontWeight: 700,
                            fontSize: "var(--fs-body)",
                          }}
                        >
                          {selectedOrder.is_active ? (
                            "This work order will be moved to Inactive after saving."
                          ) : (
                            <>
                              This work order will be activated after saving.
                              <br />
                              Step on activation:{" "}
                              <strong>
                                {form.activation_process_step ||
                                  selectedOrder.current_process_step ||
                                  getInitialProcessStepForOrder(
                                    selectedOrder.work_order_type,
                                    form.included_steps,
                                  )}
                              </strong>
                            </>
                          )}
                        </div>
                      )}

                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: "14px",
                      paddingTop: "14px",
                      borderTop: `1px solid ${COLORS.border}`,
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "8px",
                      flexWrap: "wrap",
                    }}
                  >
                    {!selectedOrder.is_active && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowInactiveActivationForm(false)}
                          style={secondaryBtn}
                        >
                          Cancel
                        </button>
                        <button onClick={() => void saveWorkOrder()} style={primaryBtn}>
                          Activate Work Order
                        </button>
                      </>
                    )}
                    {selectedOrder.is_active && (
                      <button onClick={() => void saveWorkOrder()} style={primaryBtn}>
                        Save Work Order
                      </button>
                    )}
                  </div>
                </section>
              </>
            )}
          </>
        )}

        <section style={{ ...sectionCard, marginTop: MAJOR_SECTION_GAP }}>
          <h2 style={{ ...fieldTitleStyle, marginBottom: "4px" }}>
            Add an additional task
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 0.8fr) auto",
              gap: "10px",
              alignItems: "end",
            }}
          >
            <div>
              <div style={eyebrowStyle}>Description</div>
              <input
                value={extraActionForm.description}
                onChange={(e) =>
                  setExtraActionForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="What has to be done?"
                style={inputStyle}
              />
            </div>

            <div>
              <div style={eyebrowStyle}>Responsible Person / Team</div>
              <select
                value={extraActionForm.responsible_person_team}
                onChange={(e) =>
                  setExtraActionForm((prev) => ({
                    ...prev,
                    responsible_person_team: e.target.value,
                  }))
                }
                style={inputStyle}
              >
                <option value="">Shop (default)</option>
                {shopStaff.map((s) => (
                  <option
                    key={s.id}
                    value={s.name}
                    disabled={todayAbsentEngineerIdSet.has(s.id)}
                  >
                    {s.name}
                    {todayAbsentEngineerIdSet.has(s.id) ? " (absent today)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={eyebrowStyle}>Due Date</div>
              <input
                type="date"
                value={extraActionForm.due_date}
                onChange={(e) =>
                  setExtraActionForm((prev) => ({
                    ...prev,
                    due_date: e.target.value,
                  }))
                }
                style={inputStyle}
              />
            </div>

            <button
              type="button"
              onClick={() => void saveExtraAction()}
              style={primaryBtn}
            >
              Add action
            </button>
          </div>
        </section>

        {saveStatus && (
          <div
            style={{
              marginTop: "12px",
              padding: "10px 12px",
              backgroundColor: COLORS.cardBg,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: "10px",
              fontSize: "var(--fs-body)",
              color: COLORS.textSoft,
            }}
          >
            {saveStatus}
          </div>
        )}

        {extraActionStatus && (
          <div
            style={{
              marginTop: "12px",
              padding: "10px 12px",
              backgroundColor: COLORS.cardBg,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: "10px",
              fontSize: "var(--fs-body)",
              color: COLORS.textSoft,
            }}
          >
            {extraActionStatus}
          </div>
        )}
      </div>
    </main>
  );
}

export default function OfficeUpdatePage() {
  return (
    <RequireRole allowedRoles={["office"]}>
      <OfficeUpdatePageContent />
    </RequireRole>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        backgroundColor: "#faf8f3",
        border: "1px solid #e2ddd1",
        borderRadius: "10px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: "var(--fs-xs)",
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
          fontSize: "var(--fs-md)",
          fontWeight: 700,
          color: "#1f2937",
          lineHeight: 1.3,
        }}
      >
        {value}
      </div>
    </div>
  );
}

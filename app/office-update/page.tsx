"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  due_date: string | null;
  priority: string | null;
  assigned_person_team: string | null;
  hold_reason: string | null;
  required_next_action: string | null;
  action_owner: string | null;
  action_status: string | null;
  action_closed: boolean | null;
  is_active: boolean;
  work_order_type: string | null;
  current_process_step: string | null;
};

type FormState = {
  due_date: string;
  priority: string;
  assigned_person_team: string;
  hold_reason: string;
  required_next_action: string;
  action_owner: string;
  action_status: string;
  action_closed: boolean;
  is_active: boolean;
};

const EMPTY_FORM: FormState = {
  due_date: "",
  priority: "No",
  assigned_person_team: "",
  hold_reason: "",
  required_next_action: "",
  action_owner: "",
  action_status: "",
  action_closed: false,
  is_active: true,
};

type StaffMember = {
  id: number;
  name: string;
  role: string | null;
};

export default function OfficeUpdatePage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [shopStaff, setShopStaff] = useState<StaffMember[]>([]);
  const [officeStaff, setOfficeStaff] = useState<StaffMember[]>([]);
  const [allStaff, setAllStaff] = useState<StaffMember[]>([]);
  const [activateId, setActivateId] = useState("");
  const [activateStatus, setActivateStatus] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");

  useEffect(() => {
    async function load() {
      const { data: wo } = await supabase
        .from("work_orders")
        .select(
          "work_order_id, customer, due_date, priority, assigned_person_team, hold_reason, required_next_action, action_owner, action_status, action_closed, is_active, work_order_type, current_process_step",
        )
        .eq("is_open", true)
        .order("work_order_id", { ascending: false });

      const { data: staff } = await supabase
        .from("engineers")
        .select("id, name, role")
        .eq("is_active", true)
        .order("name");

      const staffData = (staff as StaffMember[]) || [];
      setAllStaff(staffData);
      setShopStaff(staffData.filter((s) => s.role === "shop"));
      setOfficeStaff(staffData.filter((s) => s.role === "office"));

      setOrders((wo as WorkOrder[]) || []);
      setLoading(false);
    }

    load();
  }, []);

  const inactiveOrders = useMemo(() => orders.filter((o) => !o.is_active), [orders]);
  const activeOrders = useMemo(() => orders.filter((o) => o.is_active), [orders]);
  const selectedOrder = useMemo(
    () => orders.find((o) => o.work_order_id === selectedId),
    [orders, selectedId],
  );
  const hasHoldReason = Boolean(form.hold_reason.trim());
  const dueDateRequired = form.priority === "Yes" || form.priority === "AOG";

  async function activateOrder() {
    if (!activateId) return;

    const order = orders.find((o) => o.work_order_id === activateId);
    const preservedStep = order?.current_process_step?.trim() || "";
    const nextProcessStep = preservedStep || "Intake";

    setActivateStatus("Activating...");

    const payload = {
      is_active: true,
      current_process_step: nextProcessStep,
      last_manual_update: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("work_orders")
      .update(payload)
      .eq("work_order_id", activateId);

    if (error) {
      setActivateStatus(`Error: ${error.message}`);
      return;
    }

    setActivateStatus("✅ Activated!");
    setOrders((prev) =>
      prev.map((o) =>
        o.work_order_id === activateId
          ? { ...o, is_active: true, current_process_step: nextProcessStep }
          : o,
      ),
    );
    setActivateId("");
  }

  function selectOrder(id: string) {
    const order = orders.find((o) => o.work_order_id === id);
    if (!order) return;

    const orderHasHoldReason = Boolean(order.hold_reason?.trim());

    setSelectedId(id);
    setForm({
      due_date: order.due_date || "",
      priority: order.priority || "No",
      assigned_person_team: order.assigned_person_team || "",
      hold_reason: order.hold_reason || "",
      required_next_action: orderHasHoldReason ? order.required_next_action || "" : "",
      action_owner: orderHasHoldReason ? order.action_owner || "" : "",
      action_status: orderHasHoldReason ? order.action_status || "Open" : "",
      action_closed: orderHasHoldReason ? Boolean(order.action_closed) : false,
      is_active: order.is_active,
    });
    setSaveStatus("");
  }

  function setActionStatus(status: string) {
    if (status === "Done") {
      setForm((prev) => ({
        ...prev,
        action_status: "Done",
        action_closed: true,
        hold_reason: "",
        required_next_action: "",
        action_owner: "",
      }));
      return;
    }

    setForm((prev) => ({
      ...prev,
      action_status: "Open",
      action_closed: false,
    }));
  }

  function updateHoldReason(value: string) {
    setForm((prev) => {
      const trimmed = value.trim();

      if (!trimmed) {
        return {
          ...prev,
          hold_reason: "",
          required_next_action: "",
          action_owner: "",
          action_status: "",
          action_closed: false,
        };
      }

      const isNewAction =
        !prev.hold_reason.trim() || prev.action_status === "Done";

      return {
        ...prev,
        hold_reason: value,
        action_status: isNewAction ? "Open" : prev.action_status || "Open",
        action_closed: false,
      };
    });
  }

  async function saveOrder() {
    if (!selectedId) return;

    if ((form.priority === "Yes" || form.priority === "AOG") && !form.due_date) {
      setSaveStatus("❌ Due Date is required when Priority is Yes or AOG.");
      return;
    }

    const normalizedAssignedPersonTeam = form.assigned_person_team.trim() || "Shop";
    const normalizedHoldReason = form.hold_reason.trim();
    const shouldStoreActionFields = Boolean(normalizedHoldReason);
    const normalizedRequiredNextAction = form.required_next_action.trim();
    const normalizedActionOwner = form.action_owner.trim();
    const normalizedActionStatus = shouldStoreActionFields
      ? form.action_status || "Open"
      : null;

    setSaveStatus("Saving...");

    const payload = {
      due_date: form.due_date || null,
      priority: form.priority,
      assigned_person_team: normalizedAssignedPersonTeam,
      hold_reason: shouldStoreActionFields ? normalizedHoldReason : null,
      required_next_action:
        shouldStoreActionFields && normalizedRequiredNextAction
          ? normalizedRequiredNextAction
          : null,
      action_owner:
        shouldStoreActionFields && normalizedActionOwner
          ? normalizedActionOwner
          : null,
      action_status: normalizedActionStatus,
      action_closed: shouldStoreActionFields
        ? normalizedActionStatus === "Done"
        : false,
      is_active: form.is_active,
      last_manual_update: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("work_orders")
      .update(payload)
      .eq("work_order_id", selectedId);

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    setSaveStatus("✅ Saved!");
    setOrders((prev) =>
      prev.map((o) =>
        o.work_order_id === selectedId
          ? {
              ...o,
              ...payload,
              assigned_person_team: normalizedAssignedPersonTeam,
            }
          : o,
      ),
    );
  }

  if (loading) return <div style={{ padding: "20px" }}>Loading...</div>;

  const pageStyle: React.CSSProperties = {
    padding: "20px",
    maxWidth: "900px",
    margin: "0 auto",
  };

  const sectionStyle: React.CSSProperties = {
    background: "white",
    padding: "20px",
    borderRadius: "10px",
    marginTop: "20px",
    boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginTop: "12px",
    fontWeight: "bold",
    fontSize: "13px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px",
    border: "1px solid #ccc",
    borderRadius: "4px",
    fontSize: "14px",
    marginTop: "4px",
    boxSizing: "border-box",
  };

  const selectStyle: React.CSSProperties = { ...inputStyle };

  const helperStyle: React.CSSProperties = {
    marginTop: "4px",
    fontSize: "12px",
    color: "#666",
  };

  const errorHelperStyle: React.CSSProperties = {
    marginTop: "4px",
    fontSize: "12px",
    color: "#b91c1c",
    fontWeight: "bold",
  };

  const buttonStyle: React.CSSProperties = {
    padding: "10px 20px",
    backgroundColor: "#0070f3",
    color: "white",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "14px",
    marginTop: "16px",
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: "#111827",
  };

  const warningStyle: React.CSSProperties = {
    marginTop: "12px",
    padding: "10px 12px",
    background: "#fff7ed",
    border: "1px solid #fdba74",
    borderRadius: "8px",
    fontSize: "14px",
  };

  return (
    <div style={pageStyle}>
      <h1 style={{ marginBottom: "8px" }}>Office Update</h1>
      <Link href="/" style={{ color: "#0070f3", textDecoration: "none" }}>
        ← Home
      </Link>

      <div style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Activate Work Order</h2>
        <p>
          Select an inactive work order to activate ({inactiveOrders.length} available)
        </p>

        <label style={labelStyle}>Select Work Order</label>
        <select
          style={selectStyle}
          value={activateId}
          onChange={(e) => setActivateId(e.target.value)}
        >
          <option value="">-- Choose an inactive work order --</option>
          {inactiveOrders.map((o) => (
            <option key={o.work_order_id} value={o.work_order_id}>
              {o.work_order_id} — {o.customer || "No customer"} — {o.work_order_type || "Unknown type"}
            </option>
          ))}
        </select>

        <div style={helperStyle}>
          New active orders without a process step automatically start at <strong>Intake</strong>.
          Orders that were already further along keep their current step.
        </div>

        {activateId && (
          <button style={buttonStyle} onClick={activateOrder}>
            ✅ Activate this work order
          </button>
        )}

        {activateStatus && <p>{activateStatus}</p>}
      </div>

      <div style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Update Active Work Order</h2>
        <p>{activeOrders.length} active work orders</p>

        <label style={labelStyle}>Select Work Order</label>
        <select
          style={selectStyle}
          value={selectedId}
          onChange={(e) => selectOrder(e.target.value)}
        >
          <option value="">-- Choose an active work order --</option>
          {activeOrders.map((o) => (
            <option key={o.work_order_id} value={o.work_order_id}>
              {o.work_order_id} — {o.customer || "No customer"} — {o.work_order_type || "Unknown type"}
            </option>
          ))}
        </select>

        {selectedId && (
          <>
            {selectedOrder && (
              <p style={{ marginTop: "12px" }}>
                Type: {selectedOrder.work_order_type || "Unknown"} | Customer: {selectedOrder.customer || "–"}
              </p>
            )}

            <label style={labelStyle}>Active</label>
            <select
              style={selectStyle}
              value={String(form.is_active)}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  is_active: e.target.value === "true",
                }))
              }
            >
              <option value="true">Yes — visible in Dashboard, Planning, Shop</option>
              <option value="false">No — back to Backlog</option>
            </select>

            <label style={labelStyle}>Due Date</label>
            <input
              type="date"
              style={{
                ...inputStyle,
                borderColor: dueDateRequired && !form.due_date ? "#dc2626" : "#ccc",
              }}
              value={form.due_date}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, due_date: e.target.value }))
              }
            />
            {dueDateRequired && !form.due_date && (
              <div style={errorHelperStyle}>
                Due Date is required when Priority is set to Yes or AOG.
              </div>
            )}

            <label style={labelStyle}>Priority</label>
            <select
              style={selectStyle}
              value={form.priority}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, priority: e.target.value }))
              }
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
              <option value="AOG">AOG</option>
            </select>
            {dueDateRequired && (
              <div style={helperStyle}>
                A Due Date is required for <strong>Yes</strong> or <strong>AOG</strong> priority.
              </div>
            )}

            <label style={labelStyle}>Assigned Person/Team</label>
            <select
              style={selectStyle}
              value={form.assigned_person_team}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  assigned_person_team: e.target.value,
                }))
              }
            >
              <option value="">Shop (default)</option>
              {shopStaff.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
            <div style={helperStyle}>
              Assign to a specific engineer or leave as <strong>Shop</strong>.
            </div>

            <label style={labelStyle}>Hold Reason (leave empty if not blocked)</label>
            <input
              type="text"
              style={inputStyle}
              value={form.hold_reason}
              onChange={(e) => updateHoldReason(e.target.value)}
              placeholder="E.g. Parts on order, RFQ Send, Awaiting customer..."
            />

            {hasHoldReason ? (
              <>
                <label style={labelStyle}>Required Next Action</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={form.required_next_action}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      required_next_action: e.target.value,
                    }))
                  }
                  placeholder="What needs to happen?"
                />

                <label style={labelStyle}>Action Owner</label>
                <select
                  style={selectStyle}
                  value={form.action_owner}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      action_owner: e.target.value,
                    }))
                  }
                >
                  <option value="">-- Select owner --</option>
                  {officeStaff.length > 0 && (
                    <optgroup label="Office">
                      {officeStaff.map((s) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {shopStaff.length > 0 && (
                    <optgroup label="Shop">
                      {shopStaff.map((s) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>

                <label style={labelStyle}>Action Status</label>
                <select
                  style={selectStyle}
                  value={form.action_status || "Open"}
                  onChange={(e) => setActionStatus(e.target.value)}
                >
                  <option value="Open">Open</option>
                  <option value="Done">
                    Done — automatically clears hold reason, action and owner
                  </option>
                </select>

                <div style={warningStyle}>
                  ⚠ This work order is blocked due to: {form.hold_reason}
                </div>
              </>
            ) : (
              <div style={helperStyle}>
                Enter a hold reason first. The action fields will appear automatically.
              </div>
            )}

            <button style={secondaryButtonStyle} onClick={saveOrder}>
              Save Work Order
            </button>

            {saveStatus && <p>{saveStatus}</p>}
          </>
        )}
      </div>
    </div>
  );
}
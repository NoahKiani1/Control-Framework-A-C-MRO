import assert from "node:assert/strict";
import { sortSharedPlanningOrders } from "../lib/work-order-rules";

const orders = [
  {
    work_order_id: "WO-10",
    priority: null,
    due_date: "2026-05-10",
    shared_planning_rank: 2000,
  },
  {
    work_order_id: "WO-20",
    priority: "AOG",
    due_date: "2026-05-07",
    shared_planning_rank: 1000,
  },
  {
    work_order_id: "WO-30",
    priority: "Yes",
    due_date: "2026-05-08",
    shared_planning_rank: 3000,
  },
];

assert.deepEqual(
  sortSharedPlanningOrders(orders).map((order) => order.work_order_id),
  ["WO-20", "WO-10", "WO-30"],
);

assert.deepEqual(
  sortSharedPlanningOrders([
    {
      work_order_id: "WO-40",
      priority: null,
      due_date: null,
      shared_planning_rank: null,
    },
    {
      work_order_id: "WO-50",
      priority: "Yes",
      due_date: "2026-05-09",
      shared_planning_rank: null,
    },
    {
      work_order_id: "WO-60",
      priority: null,
      due_date: "2026-05-08",
      shared_planning_rank: null,
    },
  ]).map((order) => order.work_order_id),
  ["WO-50", "WO-60", "WO-40"],
);

console.log("Shared planning order tests passed.");
// noah was hier

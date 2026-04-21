import { PROCESS_STEPS, READY_TO_CLOSE_STEP } from "@/lib/process-steps";
import { isRfqBlockedState } from "@/lib/work-order-rules";
import { getTotalHoursForPart, FALLBACK_HOURS } from "@/lib/part-number-hours";

// === PROCESS STAPPEN MET GEWICHT (dummy, later aanpasbaar) ===
// Weight = percentage of total hours this step takes

// === STEP WEIGHTS - gebaseerd op representatieve tijden per stap ===
// Repair  totaal: 210 min  (Intake 10 + Disassembly 10 + Cleaning 20 + Magnetic Test 0 +
//                           Eddy Current 60 + Inspection 20 + Assembly 60 + EASA 30)
// Overhaul totaal: 350 min (Intake 10 + Disassembly 10 + Cleaning 20 + Paint Stripping 20 +
//                           Magnetic Test 0 + Penetrant 60 + Eddy Current 60 +
//                           Inspection 20 + Painting 60 + Assembly 60 + EASA 30)
// Magnetic Test heeft weight 0: de stap bestaat in de flow maar telt niet mee in uren
// (wordt optioneel uitgevoerd, zelden van toepassing)
// "Repair" stap is vervallen: valt samen met Assembly

export const STEP_WEIGHTS: Record<string, Record<string, number>> = {
  "Wheel Repair": {
    "Intake":          0.05, // 10/210
    "Disassembly":     0.05, // 10/210
    "Cleaning":        0.10, // 20/210
    "Magnetic Test": 0.00, // optioneel, geen vaste tijd
    "Eddy Current":    0.28, // 60/210
    "Inspection":      0.10, // 20/210
    "Assembly":        0.28, // 60/210 (inclusief repair)
    "EASA-Form 1":     0.14, // 30/210
  },
  "Wheel Overhaul": {
    "Intake":                  0.03, // 10/350
    "Disassembly":             0.03, // 10/350
    "Cleaning":                0.06, // 20/350
    "Paint Stripping":         0.06, // 20/350
    "Magnetic Test": 0.00, // optioneel, geen vaste tijd
    "Penetrant Testing":0.17, // 60/350
    "Eddy Current":            0.17, // 60/350
    "Inspection":              0.06, // 20/350
    "Painting":                0.17, // 60/350
    "Assembly":                0.17, // 60/350 (inclusief repair)
    "EASA-Form 1":             0.08, // 30/350
  },
  "Brake Repair": {
    "Intake":          0.05,
    "Disassembly":     0.05,
    "Cleaning":        0.10,
    "Magnetic Test": 0.00,
    "Eddy Current":    0.28,
    "Inspection":      0.10,
    "Assembly":        0.28,
    "EASA-Form 1":     0.14,
  },
  "Brake Overhaul": {
    "Intake":                  0.03,
    "Disassembly":             0.03,
    "Cleaning":                0.06,
    "Paint Stripping":         0.06,
    "Magnetic Test": 0.00,
    "Penetrant Testing":0.17,
    "Eddy Current":            0.17,
    "Inspection":              0.06,
    "Painting":                0.17,
    "Assembly":                0.17,
    "EASA-Form 1":             0.08,
  },
  "Battery": {
    "Disassembly":  0.10,
    "Cleaning":     0.10,
    "Inspection":   0.20,
    "Assembly":     0.55,
    "EASA-Form 1":  0.05,
  },
};

// === PROCESS STAP VOLGORDE ===

export const STEP_ORDER: Record<string, string[]> = PROCESS_STEPS;

// === BEREKENINGEN ===

export function getRemainingHours(
  workOrderType: string | null,
  currentStep: string | null,
  partNumber?: string | null, // ← nieuw
): number {
  if (!workOrderType || !FALLBACK_HOURS[workOrderType]) return 0;

  const total = getTotalHoursForPart(workOrderType, partNumber);

  const steps = STEP_ORDER[workOrderType];
  const weights = STEP_WEIGHTS[workOrderType];

  if (!currentStep || !steps.includes(currentStep)) return total;

  // Sum weights of all steps AFTER the current step (including current)
  const currentIndex = steps.indexOf(currentStep);
  let completedWeight = 0;
  for (let i = 0; i < currentIndex; i++) {
    completedWeight += weights[steps[i]] || 0;
  }

  return Math.round(total * (1 - completedWeight) * 10) / 10;
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function getWorkDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);

  while (current <= endDate) {
    if (!isWeekend(current)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export function getHoursForDay(date: Date): number {
  const day = date.getDay();
  if (day === 5) return 6; // Friday
  if (day >= 1 && day <= 4) return 8; // Mon-Thu
  return 0; // weekend
}

// Calculate the work days in a week from startDate through Friday
export function getWorkDaysInWeek(weekStart: Date): Date[] {
  const days: Date[] = [];
  const current = new Date(weekStart);
  current.setHours(0, 0, 0, 0);

  // Go to end of the week (Friday)
  const endOfWeek = new Date(current);
  const dayOfWeek = endOfWeek.getDay();
  const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 0;
  endOfWeek.setDate(endOfWeek.getDate() + daysUntilFriday);

  while (current <= endOfWeek) {
    if (!isWeekend(current)) {
      days.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }
  return days;
}

// Calculate the Monday of a week
export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export type WeekCapacity = {
  weekLabel: string;
  weekStart: Date;
  workDays: Date[];
  availableHours: number;
  requiredHours: number;
  percentage: number;
  status: "green" | "orange" | "red";
};

export type OrderCapacity = {
  work_order_id: string;
  customer: string | null;
  work_order_type: string | null;
  part_number: string | null;
  current_step: string | null;
  due_date: string;
  remaining_hours: number;
  hours_per_day: number;
  is_overdue: boolean;
};

export function calculateWeekCapacity(
  orders: {
    work_order_id: string;
    customer: string | null;
    work_order_type: string | null;
    part_number: string | null;
    current_process_step: string | null;
    due_date: string | null;
    hold_reason: string | null;
    rfq_state: string | null;
  }[],
  engineerCount: number,
  absenceDates: Date[],
): { weeks: WeekCapacity[]; orderDetails: OrderCapacity[]; overdueOrders: OrderCapacity[] } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 3 weeks: current week (from today) + 2 next weeks
  const weeks: WeekCapacity[] = [];
  const orderDetails: OrderCapacity[] = [];
  const overdueOrders: OrderCapacity[] = [];

  // Week 1: from today to Friday
  const week1Start = new Date(today);
  const week1Monday = getMondayOfWeek(today);

  // Week 2: next Monday
  const week2Monday = new Date(week1Monday);
  week2Monday.setDate(week2Monday.getDate() + 7);

  // Week 3: Monday after that
  const week3Monday = new Date(week2Monday);
  week3Monday.setDate(week3Monday.getDate() + 7);

  const weekStarts = [week1Start, week2Monday, week3Monday];
  const weekLabels = ["This week", "Next week", "In 2 weeks"];

  // Calculate per week
  for (let w = 0; w < 3; w++) {
    const workDays = getWorkDaysInWeek(weekStarts[w]);

    // Available hours: per day per engineer, minus absences
    let available = 0;
    for (const day of workDays) {
      const hoursPerEngineer = getHoursForDay(day);
      const absentCount = absenceDates.filter(
        (a) => a.getTime() === day.getTime()
      ).length;
      const activeEngineers = Math.max(0, engineerCount - absentCount);
      available += hoursPerEngineer * activeEngineers;
    }

    weeks.push({
      weekLabel: weekLabels[w],
      weekStart: weekStarts[w],
      workDays,
      availableHours: Math.round(available * 10) / 10,
      requiredHours: 0,
      percentage: 0,
      status: "green",
    });
  }

  // Calculate required hours per day per order and distribute across weeks
  const filteredOrders = orders.filter((o) => {
    if (!o.due_date) return false;
    if (o.hold_reason) return false;
    if (isRfqBlockedState(o.rfq_state)) return false;
    if (o.current_process_step === READY_TO_CLOSE_STEP) return false;
    return true;
  });

  for (const order of filteredOrders) {
    // ↓ enige wijziging: geef part_number mee
    const remaining = getRemainingHours(order.work_order_type, order.current_process_step, order.part_number);
    if (remaining <= 0) continue;

    const dueDate = new Date(order.due_date!);
    dueDate.setHours(0, 0, 0, 0);

    const isOverdue = dueDate < today;

    const detail: OrderCapacity = {
      work_order_id: order.work_order_id,
      customer: order.customer,
      work_order_type: order.work_order_type,
      part_number: order.part_number,
      current_step: order.current_process_step,
      due_date: order.due_date!,
      remaining_hours: remaining,
      hours_per_day: 0,
      is_overdue: isOverdue,
    };

    if (isOverdue) {
      // All hours on current week
      weeks[0].requiredHours += remaining;
      detail.hours_per_day = remaining;
      overdueOrders.push(detail);
      orderDetails.push(detail);
      continue;
    }

    // Work days between today and due_date
    const workDays = getWorkDaysBetween(today, dueDate);
    if (workDays <= 0) continue;

    const hoursPerDay = remaining / workDays;
    detail.hours_per_day = Math.round(hoursPerDay * 10) / 10;
    orderDetails.push(detail);

    // Distribute hours across the 3 weeks
    for (let w = 0; w < 3; w++) {
      for (const day of weeks[w].workDays) {
        if (day >= today && day <= dueDate) {
          weeks[w].requiredHours += hoursPerDay;
        }
      }
    }
  }

  // Round off and calculate status
  for (const week of weeks) {
    week.requiredHours = Math.round(week.requiredHours * 10) / 10;

    if (week.availableHours === 0) {
      week.percentage = week.requiredHours > 0 ? 100 : 0;
    } else {
      week.percentage = Math.round((week.requiredHours / week.availableHours) * 100);
    }

    if (week.percentage >= 100) week.status = "red";
    else if (week.percentage >= 80) week.status = "orange";
    else week.status = "green";
  }

  return { weeks, orderDetails, overdueOrders };
}

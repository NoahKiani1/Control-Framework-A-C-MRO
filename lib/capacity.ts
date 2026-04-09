// === STANDAARD MANUREN PER TYPE (dummy, later aanpasbaar) ===

export const TOTAL_HOURS: Record<string, number> = {
  "Wheel Repair": 10,
  "Wheel Overhaul": 20,
  "Brake Repair": 10,
  "Brake Overhaul": 20,
  "Battery": 6,
};

// === PROCESS STAPPEN MET GEWICHT (dummy, later aanpasbaar) ===
// Gewicht = percentage van totale uren dat deze stap kost

export const STEP_WEIGHTS: Record<string, Record<string, number>> = {
  "Wheel Repair": {
    "Intake": 0.05,
    "Disassembly": 0.10,
    "Cleaning": 0.10,
    "Inspection": 0.15,
    "Eddy Current": 0.15,
    "Repair": 0.25,
    "Assembly": 0.15,
    "EASA-Form 1": 0.05,
  },
  "Wheel Overhaul": {
    "Intake": 0.03,
    "Disassembly": 0.08,
    "Cleaning": 0.07,
    "Paint Blasting": 0.07,
    "Inspection": 0.10,
    "Penetrant NDT Inspection": 0.10,
    "Eddy Current": 0.10,
    "Repair": 0.20,
    "Painting": 0.07,
    "Assembly": 0.13,
    "EASA-Form 1": 0.05,
  },
  "Brake Repair": {
    "Intake": 0.05,
    "Disassembly": 0.10,
    "Cleaning": 0.10,
    "Inspection": 0.15,
    "Eddy Current": 0.15,
    "Repair": 0.25,
    "Assembly": 0.15,
    "EASA-Form 1": 0.05,
  },
  "Brake Overhaul": {
    "Intake": 0.03,
    "Disassembly": 0.08,
    "Cleaning": 0.07,
    "Paint Blasting": 0.07,
    "Inspection": 0.10,
    "Penetrant NDT Inspection": 0.10,
    "Eddy Current": 0.10,
    "Repair": 0.20,
    "Painting": 0.07,
    "Assembly": 0.13,
    "EASA-Form 1": 0.05,
  },
  "Battery": {
    "Disassembly": 0.10,
    "Cleaning": 0.10,
    "Inspection": 0.20,
    "Repair": 0.35,
    "Assembly": 0.20,
    "EASA-Form 1": 0.05,
  },
};

// === PROCESS STAP VOLGORDE ===

export const STEP_ORDER: Record<string, string[]> = {
  "Wheel Repair": ["Intake", "Disassembly", "Cleaning", "Inspection", "Eddy Current", "Repair", "Assembly", "EASA-Form 1"],
  "Wheel Overhaul": ["Intake", "Disassembly", "Cleaning", "Paint Blasting", "Inspection", "Penetrant NDT Inspection", "Eddy Current", "Repair", "Painting", "Assembly", "EASA-Form 1"],
  "Brake Repair": ["Intake", "Disassembly", "Cleaning", "Inspection", "Eddy Current", "Repair", "Assembly", "EASA-Form 1"],
  "Brake Overhaul": ["Intake", "Disassembly", "Cleaning", "Paint Blasting", "Inspection", "Penetrant NDT Inspection", "Eddy Current", "Repair", "Painting", "Assembly", "EASA-Form 1"],
  "Battery": ["Disassembly", "Cleaning", "Inspection", "Repair", "Assembly", "EASA-Form 1"],
};

// === BEREKENINGEN ===

export function getRemainingHours(workOrderType: string | null, currentStep: string | null): number {
  if (!workOrderType || !TOTAL_HOURS[workOrderType]) return 0;

  const total = TOTAL_HOURS[workOrderType];
  const steps = STEP_ORDER[workOrderType];
  const weights = STEP_WEIGHTS[workOrderType];

  if (!currentStep || !steps.includes(currentStep)) return total;

  // Tel gewichten op van alle stappen NA de huidige stap (inclusief huidige)
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
  if (day === 5) return 6; // vrijdag
  if (day >= 1 && day <= 4) return 8; // ma-do
  return 0; // weekend
}

// Bereken de werkdagen in een week vanaf startDatum tot en met vrijdag
export function getWorkDaysInWeek(weekStart: Date): Date[] {
  const days: Date[] = [];
  const current = new Date(weekStart);
  current.setHours(0, 0, 0, 0);

  // Ga naar het einde van de week (vrijdag)
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

// Bereken de maandag van een week
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

  // 3 weken: huidige week (vanaf vandaag) + 2 volgende weken
  const weeks: WeekCapacity[] = [];
  const orderDetails: OrderCapacity[] = [];
  const overdueOrders: OrderCapacity[] = [];

  // Week 1: vanaf vandaag tot vrijdag
  const week1Start = new Date(today);
  const week1Monday = getMondayOfWeek(today);

  // Week 2: volgende maandag
  const week2Monday = new Date(week1Monday);
  week2Monday.setDate(week2Monday.getDate() + 7);

  // Week 3: maandag daarna
  const week3Monday = new Date(week2Monday);
  week3Monday.setDate(week3Monday.getDate() + 7);

  const weekStarts = [week1Start, week2Monday, week3Monday];
  const weekLabels = ["Deze week", "Volgende week", "Over 2 weken"];

  // Bereken per week
  for (let w = 0; w < 3; w++) {
    const workDays = getWorkDaysInWeek(weekStarts[w]);

    // Beschikbare uren: per dag per engineer, minus absences
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

  // Bereken per order de required hours per dag en verdeel over weken
  const filteredOrders = orders.filter((o) => {
    if (!o.due_date) return false;
    if (o.hold_reason) return false;
    if (o.rfq_state === "RFQ Send" || o.rfq_state === "RFQ Denied") return false;
    if (o.current_process_step === "EASA-Form 1") return false;
    return true;
  });

  for (const order of filteredOrders) {
    const remaining = getRemainingHours(order.work_order_type, order.current_process_step);
    if (remaining <= 0) continue;

    const dueDate = new Date(order.due_date!);
    dueDate.setHours(0, 0, 0, 0);

    const isOverdue = dueDate < today;

    const detail: OrderCapacity = {
      work_order_id: order.work_order_id,
      customer: order.customer,
      work_order_type: order.work_order_type,
      due_date: order.due_date!,
      remaining_hours: remaining,
      hours_per_day: 0,
      is_overdue: isOverdue,
    };

    if (isOverdue) {
      // Alle uren op huidige week
      weeks[0].requiredHours += remaining;
      detail.hours_per_day = remaining;
      overdueOrders.push(detail);
      orderDetails.push(detail);
      continue;
    }

    // Werkdagen tussen vandaag en due_date
    const workDays = getWorkDaysBetween(today, dueDate);
    if (workDays <= 0) continue;

    const hoursPerDay = remaining / workDays;
    detail.hours_per_day = Math.round(hoursPerDay * 10) / 10;
    orderDetails.push(detail);

    // Verdeel uren over de 3 weken
    for (let w = 0; w < 3; w++) {
      for (const day of weeks[w].workDays) {
        if (day >= today && day <= dueDate) {
          weeks[w].requiredHours += hoursPerDay;
        }
      }
    }
  }

  // Afronden en status berekenen
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

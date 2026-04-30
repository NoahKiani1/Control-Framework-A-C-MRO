"use client";

import { useCallback, useState } from "react";
import { AcmpPendingGate } from "./acmp-pending-gate";
import { YearEndReportGate } from "./year-end-report-gate";

export function GlobalGates() {
  const [yearEndRequired, setYearEndRequired] = useState<boolean | null>(null);

  const handleYearEndRequirementChange = useCallback((required: boolean) => {
    setYearEndRequired(required);
  }, []);

  return (
    <>
      <YearEndReportGate
        onRequirementChange={handleYearEndRequirementChange}
      />
      <AcmpPendingGate suppress={yearEndRequired !== false} />
    </>
  );
}

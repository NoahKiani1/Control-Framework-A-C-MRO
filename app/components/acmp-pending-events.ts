"use client";

export const ACMP_PENDING_REVIEW_REFRESH_EVENT =
  "acmp:pending-review-refresh";

export function dispatchAcmpPendingReviewRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ACMP_PENDING_REVIEW_REFRESH_EVENT));
}

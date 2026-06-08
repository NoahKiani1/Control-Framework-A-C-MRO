import { RequireRole } from "@/app/components/require-role";
import { ShopUpdateClient } from "@/app/components/shop-update/shop-update-client";

export default function ShopUpdatePage() {
  return (
    <RequireRole allowedRoles={["office", "shop"]}>
      <ShopUpdateClient variant="desktop" />
    </RequireRole>
  );
}
// noah was hier

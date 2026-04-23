import { RequireRole } from "@/app/components/require-role";
import { ShopUpdateClient } from "@/app/components/shop-update/shop-update-client";

export default function ShopFormPage() {
  return (
    <RequireRole allowedRoles={["office", "shop"]}>
      <ShopUpdateClient variant="tablet" />
    </RequireRole>
  );
}

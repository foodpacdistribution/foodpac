"use client";

import { CheckCircle2, PackagePlus, Pencil, Send, XCircle } from "lucide-react";
import { changePurchaseOrderStatus, receiveGoods } from "@/app/actions/purchasing";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { ActionButton } from "@/components/purchasing-ui";
import { btn } from "@/components/ui";
import type { PurchaseOrderStatus } from "@/lib/db/schema";

export function PoActions({ id, status, canEdit, today, hasDraftReceipt }: { id: string; status: PurchaseOrderStatus; canEdit: boolean; today: string; hasDraftReceipt: string | null }) {
  const tr = useT();
  return (
    <div className="flex flex-wrap gap-2">
      {canEdit && (
        <Link href={`/admin/purchase-orders/${id}/edit`} className={btn("secondary")}>
          <Pencil className="size-4" /> {tr("Edit")}
        </Link>
      )}
      {status === "draft" && (
        <ActionButton run={() => changePurchaseOrderStatus(id, "send")} variant="primary">
          <Send className="size-4" /> {tr("Mark as sent to supplier")}
        </ActionButton>
      )}
      {(status === "draft" || status === "sent") && (
        <ActionButton run={() => changePurchaseOrderStatus(id, "confirm")} variant={status === "sent" ? "primary" : "secondary"}>
          <CheckCircle2 className="size-4" /> {tr("Supplier confirmed")}
        </ActionButton>
      )}
      {(status === "sent" || status === "confirmed" || status === "partially_received") &&
        (hasDraftReceipt ? (
          <Link href={`/admin/goods-receipts/${hasDraftReceipt}`} className={btn("success")}>
            <PackagePlus className="size-4" /> {tr("Continue checking goods in")}
          </Link>
        ) : (
          <ActionButton run={() => receiveGoods({ poId: id }, today)} variant="success" goTo={(g) => `/admin/goods-receipts/${g}`}>
            <PackagePlus className="size-4" /> {tr("Receive goods")}
          </ActionButton>
        ))}
      {status === "partially_received" && (
        <ActionButton run={() => changePurchaseOrderStatus(id, "close")} confirmText="Close this purchase order? The rest won't be expected any more.">
          {tr("Close short")}
        </ActionButton>
      )}
      {(status === "draft" || status === "sent" || status === "confirmed") && (
        <ActionButton run={() => changePurchaseOrderStatus(id, "cancel")} variant="danger" confirmText="Cancel this purchase order?">
          <XCircle className="size-4" /> {tr("Cancel")}
        </ActionButton>
      )}
    </div>
  );
}

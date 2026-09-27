"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { DiffLine } from "@/types";
import { DiffLegend, DiffView } from "./diff-view";

interface DiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: ReactNode;
  lines: DiffLine[];
  footer?: ReactNode;
}

export function DiffDialog({ open, onOpenChange, title = "Alterações", description, lines, footer }: DiffDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="lg"
      footer={
        footer ?? (
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        )
      }
    >
      <div className="space-y-3">
        <DiffLegend />
        <DiffView lines={lines} />
      </div>
    </Dialog>
  );
}

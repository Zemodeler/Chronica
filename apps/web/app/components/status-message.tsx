import type { ReactNode } from "react";

type StatusMessageProperties = Readonly<{
  kind?: "notice" | "error";
  children: ReactNode;
  id?: string;
}>;

export function StatusMessage({ kind = "notice", children, id = "status" }: StatusMessageProperties) {
  return (
    <p id={id} className={kind} role={kind === "error" ? "alert" : "status"} tabIndex={-1}>
      {children}
    </p>
  );
}

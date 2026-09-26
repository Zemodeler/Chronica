"use client";

import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { usePathname } from "next/navigation";

type TopNavLinkProps = Readonly<
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> & {
    href: string;
  }
>;

/**
 * The global bar must always change the rendered route. Ordinary anchors keep
 * auth and billing usable without JavaScript; with JavaScript we bypass a
 * failed App Router transition and ask the browser for the destination page.
 */
export function TopNavLink({ href, ...props }: TopNavLinkProps) {
  const current = usePathname() === href;
  const navigate = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.location.assign(href);
  };

  return <a {...props} href={href} onClick={navigate} aria-current={current ? "page" : undefined} />;
}

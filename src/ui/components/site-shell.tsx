import type { ReactNode } from "react";

import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export function SiteShell(props: {
  active: "home" | "examples" | "create" | "about" | null;
  authenticated?: boolean;
  children: ReactNode;
}) {
  const authenticated = props.authenticated ?? false;
  return (
    <div className={authenticated ? "site-shell site-shell-authenticated" : "site-shell"}>
      <SiteHeader
        active={props.active}
        authenticated={authenticated}
      />
      {props.children}
      <SiteFooter />
    </div>
  );
}

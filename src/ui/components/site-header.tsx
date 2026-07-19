type PublicRoute = "home" | "examples" | "create" | "about";

const publicLinks = [
  { id: "home", label: "Home", href: "/" },
  { id: "examples", label: "Pre-made example", href: "/examples" },
  { id: "about", label: "About", href: "/about" }
] as const;

const demoLink = { id: "create", label: "Demo", href: "/create" } as const;

export function SiteHeader({ active, authenticated = false }: {
  active: PublicRoute | null;
  authenticated?: boolean;
}) {
  const links = [publicLinks[0], publicLinks[1], demoLink, publicLinks[2]];
  return (
    <header className="site-header">
      <div className="site-identity"><a href="/">SketchyCut</a></div>
      <nav
        aria-label="Primary navigation"
        className={authenticated ? "site-nav-authenticated" : undefined}
      >
        {links.map((link) => (
          <a
            key={link.id}
            href={link.href}
            className={link.id === "create" ? "shell-authenticated-only" : undefined}
            aria-current={active === link.id ? "page" : undefined}
          >{link.label}</a>
        ))}
      </nav>
    </header>
  );
}

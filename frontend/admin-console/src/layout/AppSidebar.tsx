import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";

import { ChevronDownIcon, HorizontaLDots } from "../icons";
import { useSidebar } from "../context/SidebarContext";
import { useAdminActivityLog } from "../notifications/AdminActivityLogContext";

const DashboardIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path
      d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
      fill="currentColor"
    />
  </svg>
);

const PlayersIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M9 8.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM6.5 11a3.48 3.48 0 0 0-3.45 3.02L3 15.25V17h7v-1.75l-.05-.23A3.48 3.48 0 0 0 6.5 11Zm8.5-2.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM12.5 11a3.48 3.48 0 0 0-3.45 3.02L9 15.25V17h7.5v-1.75l-.05-.23A3.48 3.48 0 0 0 12.5 11Z"
      fill="currentColor"
    />
  </svg>
);

const FinanceIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M4 7.5C4 6.12 5.12 5 6.5 5h11C18.88 5 20 6.12 20 7.5v9c0 1.38-1.12 2.5-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Zm2 .5v9c0 .28.22.5.5.5h11a.5.5 0 0 0 .5-.5V8H6Zm2.5 3h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1Zm0 2.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1Z"
      fill="currentColor"
    />
  </svg>
);

const GamesIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M11.25 3.75a.75.75 0 0 1 .75-.75h.75a2.25 2.25 0 0 1 2.25 2.25v.75H18a2.25 2.25 0 0 1 2.25 2.25V12a2.25 2.25 0 0 1-2.25 2.25h-.75v.75a2.25 2.25 0 0 1-2.25 2.25H12a2.25 2.25 0 0 1-2.25-2.25v-.75H9A2.25 2.25 0 0 1 6.75 15v-2.632a.75.75 0 0 1 .336-.628l.877-.513a.75.75 0 0 0 0-1.295l-.877-.513A.75.75 0 0 1 6.75 9V6.75A2.25 2.25 0 0 1 9 4.5h.75v-.75A2.25 2.25 0 0 1 12 1.5h-.75Z"
      fill="currentColor"
    />
  </svg>
);

const BonusEngineIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path
      d="M12 2l1.09 3.36h3.54L14.18 7.1l1.09 3.36L12 8.73 8.73 10.46 9.82 7.1 6.37 5.36h3.54L12 2Z"
      fill="currentColor"
    />
    <path
      d="M5 11c0-1.66 1.34-3 3-3h8c1.66 0 3 1.34 3 3v1H5v-1Zm0 3h14v6c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2v-6Z"
      fill="currentColor"
    />
  </svg>
);

const EngagementIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path d="M5 11h14v8a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19v-8Z" fill="currentColor" />
    <path d="M4 8h16v4H4V8Z" fill="currentColor" />
    <path d="M11 5h2v15h-2V5Z" fill="currentColor" />
  </svg>
);

const OpsIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M14.5 3.5a1 1 0 0 1 .87.51l.72 1.25a5.02 5.02 0 0 1 1.73.99l1.43-.25a1 1 0 0 1 1.09.55l1 1.73a1 1 0 0 1-.15 1.16l-1.01 1.17c.08.33.12.67.12 1.02s-.04.69-.12 1.02l1.01 1.17a1 1 0 0 1 .15 1.16l-1 1.73a1 1 0 0 1-1.09.55l-1.43-.25c-.52.43-1.1.78-1.73.99l-.72 1.25a1 1 0 0 1-.87.51h-2a1 1 0 0 1-.87-.51l-.72-1.25a5.02 5.02 0 0 1-1.73-.99l-1.43.25a1 1 0 0 1-1.09-.55l-1-1.73a1 1 0 0 1 .15-1.16l1.01-1.17A5.1 5.1 0 0 1 6.5 12c0-.35.04-.69.12-1.02L5.61 9.81a1 1 0 0 1-.15-1.16l1-1.73a1 1 0 0 1 1.09-.55l1.43.25c.52-.43 1.1-.78 1.73-.99l.72-1.25A1 1 0 0 1 11.5 3.5h2Zm-.5 2h-1l-.65 1.13a1 1 0 0 1-.53.48 3.02 3.02 0 0 0-1.55.87 1 1 0 0 1-.58.28l-1.28.22-.5.87 1.01 1.17a1 1 0 0 1 .2.6c0 .22-.03.44-.03.66s.01.44.03.66a1 1 0 0 1-.2.6l-1.01 1.17.5.87 1.28.22a1 1 0 0 1 .58.28c.45.48.97.86 1.55.87a1 1 0 0 1 .53.48L14 18.5h1l.65-1.13a1 1 0 0 1 .53-.48 3.02 3.02 0 0 0 1.55-.87 1 1 0 0 1 .58-.28l1.28-.22.5-.87-1.01-1.17a1 1 0 0 1-.2-.6c0-.22.03-.44.03-.66s-.01-.44-.03-.66a1 1 0 0 1 .2-.6l1.01-1.17-.5-.87-1.28-.22a1 1 0 0 1-.58-.28 3.02 3.02 0 0 0-1.55-.87 1 1 0 0 1-.53-.48L14 5.5Zm1 5.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"
      fill="currentColor"
    />
  </svg>
);

const ComplianceIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 3.5 18 6v6.5c0 3.5-2.5 6.5-6 7.5-3.5-1-6-4-6-7.5V6l6-2.5Zm-4 4.38V12c0 2.55 1.8 4.85 4 5.85 2.2-1 4-3.3 4-5.85V7.88L12 6.35 8 7.88Zm6.2 2.32-4 4-2.1-2.1 1.06-1.06L14 12.06l2.94-2.94 1.06 1.06Z"
      fill="currentColor"
    />
  </svg>
);

type NavItem = {
  name: string;
  icon: ReactNode;
  path?: string;
  subItems?: { name: string; path: string; pro?: boolean; new?: boolean }[];
};

const navItems: NavItem[] = [
  {
    icon: <DashboardIcon />,
    name: "Dashboard",
    path: "/",
  },
  {
    icon: <FinanceIcon />,
    name: "Finance",
    subItems: [
      { name: "Overview", path: "/finance" },
      { name: "Fystack webhooks", path: "/finance/fystack-webhooks", new: true },
      { name: "Deposits", path: "/deposits" },
      { name: "Withdrawals", path: "/withdrawals" },
      { name: "Withdrawal approvals", path: "/withdrawal-approvals", new: true },
      { name: "Ledger", path: "/ledger" },
    ],
  },
  {
    icon: <PlayersIcon />,
    name: "Players",
    subItems: [
      { name: "All players", path: "/users" },
      { name: "Player lookup", path: "/support" },
    ],
  },
  {
    icon: <GamesIcon />,
    name: "Games",
    subItems: [
      { name: "Catalog", path: "/games" },
      { name: "BlueOcean events", path: "/games/blueocean-events", new: true },
      { name: "Launches", path: "/game-launches" },
      { name: "Disputes", path: "/game-disputes" },
      { name: "Provider ops", path: "/provider-ops" },
    ],
  },
  {
    icon: <BonusEngineIcon />,
    name: "Bonus Engine",
    subItems: [
      { name: "Promotions", path: "/bonushub" },
      { name: "Smart suggestions", path: "/bonushub/recommendations" },
      { name: "Create promotion", path: "/bonushub/wizard/new" },
      { name: "Calendar", path: "/bonushub/calendar" },
      { name: "Campaign analytics", path: "/bonushub/campaign-analytics", new: true },
      { name: "Operations", path: "/bonushub/operations" },
      { name: "Risk queue", path: "/bonushub/operations?tab=risk" },
    ],
  },
  {
    icon: <EngagementIcon />,
    name: "Engagement",
    subItems: [
      { name: "VIP system", path: "/engagement/vip", new: true },
      { name: "Global chat", path: "/global-chat", new: true },
    ],
  },
  {
    icon: <ComplianceIcon />,
    name: "Compliance & Risk",
    subItems: [{ name: "Audit log", path: "/audit-log", new: true }],
  },
  {
    icon: <OpsIcon />,
    name: "System",
    subItems: [
      { name: "Diagnostics", path: "/diagnostics" },
      { name: "Staff users", path: "/system/staff-users", new: true },
      { name: "Settings", path: "/settings" },
    ],
  },
];

const othersItems: NavItem[] = [];

const AppSidebar: FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const location = useLocation();
  const { unreadCount } = useAdminActivityLog();

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: "main" | "others";
    index: number;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {}
  );
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const isActive = useCallback(
    (path: string) => {
      const p = location.pathname;
      const search = location.search || "";
      const sp = new URLSearchParams(search);
      const tab = sp.get("tab") || "dashboard";

      if (path === "/") return p === "/";
      if (path === "/support") return p.startsWith("/support");
      if (path === "/games") return p === "/games" || p === "/games-catalog";
      if (path === "/games/blueocean-events") return p === "/games/blueocean-events";

      // Bonus Engine: one highlighted child at a time
      if (path === "/bonushub/operations?tab=risk") {
        return p === "/bonushub/operations" && tab === "risk";
      }
      if (path === "/bonushub/operations") {
        return p === "/bonushub/operations" && tab !== "risk";
      }
      if (path === "/bonushub/wizard/new") return p === "/bonushub/wizard/new";
      if (path === "/bonushub/calendar") return p === "/bonushub/calendar";
      if (path === "/bonushub/campaign-analytics") return p === "/bonushub/campaign-analytics";
      if (path === "/bonushub/recommendations") return p === "/bonushub/recommendations";
      if (path === "/bonushub") {
        if (p === "/bonushub") return true;
        if (p.startsWith("/bonushub/promotions/")) return true;
        return false;
      }

      if (path === "/global-chat") return p.startsWith("/global-chat");
      if (path === "/finance/fystack-webhooks") return p === "/finance/fystack-webhooks";
      if (path === "/system/staff-users") return p === "/system/staff-users";
      if (path === "/engagement/vip") return p === "/engagement/vip" || p === "/vip-program";
      if (path.includes("?")) {
        const base = path.split("?")[0];
        if (p !== base) return false;
        const want = new URLSearchParams(path.split("?")[1] || "").get("tab");
        return want === tab;
      }
      return p === path;
    },
    [location.pathname, location.search]
  );

  useEffect(() => {
    let submenuMatched = false;
    let next: { type: "main" | "others"; index: number } | null = null;
    ["main", "others"].forEach((menuType) => {
      const items = menuType === "main" ? navItems : othersItems;
      items.forEach((nav, index) => {
        if (nav.subItems) {
          nav.subItems.forEach((subItem) => {
            if (!submenuMatched && isActive(subItem.path)) {
              next = {
                type: menuType as "main" | "others",
                index,
              };
              submenuMatched = true;
            }
          });
        }
      });
    });

    const id = requestAnimationFrame(() => {
      setOpenSubmenu(submenuMatched ? next : null);
    });
    return () => cancelAnimationFrame(id);
  }, [location, isActive]);

  useEffect(() => {
    if (openSubmenu !== null) {
      const key = `${openSubmenu.type}-${openSubmenu.index}`;
      if (subMenuRefs.current[key]) {
        setSubMenuHeight((prevHeights) => ({
          ...prevHeights,
          [key]: subMenuRefs.current[key]?.scrollHeight || 0,
        }));
      }
    }
  }, [openSubmenu]);

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    setOpenSubmenu((prevOpenSubmenu) => {
      if (
        prevOpenSubmenu &&
        prevOpenSubmenu.type === menuType &&
        prevOpenSubmenu.index === index
      ) {
        return null;
      }
      return { type: menuType, index };
    });
  };

  const renderMenuItems = (items: NavItem[], menuType: "main" | "others") => (
    <ul className="flex flex-col gap-4">
      {items.map((nav, index) => (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index, menuType)}
              className={`menu-item group ${
                openSubmenu?.type === menuType && openSubmenu?.index === index
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } cursor-pointer ${
                !isExpanded && !isHovered
                  ? "lg:justify-center"
                  : "lg:justify-start"
              }`}
            >
              <span
                className={`menu-item-icon-size  ${
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }`}
              >
                {nav.icon}
              </span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <span className="menu-item-text">{nav.name}</span>
              )}
              {(isExpanded || isHovered || isMobileOpen) && (
                <ChevronDownIcon
                  className={`ml-auto w-5 h-5 transition-transform duration-200 ${
                    openSubmenu?.type === menuType &&
                    openSubmenu?.index === index
                      ? "rotate-180 text-brand-500"
                      : ""
                  }`}
                />
              )}
            </button>
          ) : (
            nav.path && (
              <Link
                to={nav.path}
                className={`menu-item group ${
                  isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                }`}
              >
                <span
                  className={`menu-item-icon-size ${
                    isActive(nav.path)
                      ? "menu-item-icon-active"
                      : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                </span>
                {(isExpanded || isHovered || isMobileOpen) && (
                  <>
                    <span className="menu-item-text">{nav.name}</span>
                    {nav.path === "/logs" && unreadCount > 0 && (
                      <span className="menu-dropdown-badge ml-auto shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </>
                )}
              </Link>
            )
          )}
          {nav.subItems && (isExpanded || isHovered || isMobileOpen) && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-all duration-300"
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
              }}
            >
              <ul className="mt-2 space-y-1 ml-9">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      to={subItem.path}
                      className={`menu-dropdown-item ${
                        isActive(subItem.path)
                          ? "menu-dropdown-item-active"
                          : "menu-dropdown-item-inactive"
                      }`}
                    >
                      {subItem.name}
                      <span className="flex items-center gap-1 ml-auto">
                        {subItem.path === "/logs" && unreadCount > 0 && (
                          <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                            {unreadCount > 99 ? "99+" : unreadCount}
                          </span>
                        )}
                        {subItem.new && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge`}
                          >
                            new
                          </span>
                        )}
                        {subItem.pro && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge`}
                          >
                            pro
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <aside
      className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-all duration-300 ease-in-out z-50 border-r border-gray-200 
        ${
          isExpanded || isMobileOpen
            ? "w-[290px]"
            : isHovered
            ? "w-[290px]"
            : "w-[90px]"
        }
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`py-8 flex ${
          !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
        }`}
      >
        <Link to="/">
          {isExpanded || isHovered || isMobileOpen ? (
            <>
              <img
                className="dark:hidden"
                src="/images/logo/logo.svg"
                alt="Logo"
                width={150}
                height={40}
              />
              <img
                className="hidden dark:block"
                src="/images/logo/logo-dark.svg"
                alt="Logo"
                width={150}
                height={40}
              />
            </>
          ) : (
            <img
              src="/images/logo/logo-icon.svg"
              alt="Logo"
              width={32}
              height={32}
            />
          )}
        </Link>
      </div>
      <div className="flex flex-col overflow-y-auto duration-300 ease-linear no-scrollbar">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2
                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                  !isExpanded && !isHovered
                    ? "lg:justify-center"
                    : "justify-start"
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? (
                  "Menu"
                ) : (
                  <HorizontaLDots className="size-6" />
                )}
              </h2>
              {renderMenuItems(navItems, "main")}
            </div>
            {othersItems.length > 0 ? (
              <div className="">
                <h2
                  className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                    !isExpanded && !isHovered
                      ? "lg:justify-center"
                      : "justify-start"
                  }`}
                >
                  {isExpanded || isHovered || isMobileOpen ? (
                    "Others"
                  ) : (
                    <HorizontaLDots />
                  )}
                </h2>
                {renderMenuItems(othersItems, "others")}
              </div>
            ) : null}
          </div>
        </nav>
      </div>
    </aside>
  );
};

export default AppSidebar;

import {
  Anchor,
  AppShell,
  Badge,
  Burger,
  Button,
  Container,
  Divider,
  Group,
  NavLink,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconShoppingCart } from "@tabler/icons-react";
import { Suspense, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useCart } from "../features/cart/cartContext";
import classes from "./AppLayout.module.css";
import { APP_NAME } from "./brand";
import { ErrorBoundary } from "./ErrorBoundary";
import { LoadingState } from "./LoadingState";
import { ADMIN_NAV, SHOP_NAV, type NavItem } from "./navigation";

function Brand() {
  return (
    <Anchor component={Link} to="/" underline="never" c="inherit" aria-label={`${APP_NAME} home`}>
      <Group gap="xs" wrap="nowrap">
        <ThemeIcon size="lg" radius="md" variant="filled" aria-hidden>
          <IconShoppingCart size={20} />
        </ThemeIcon>
        <Text fw={800} size="lg" visibleFrom="xs">
          {APP_NAME}
        </Text>
      </Group>
    </Anchor>
  );
}

function DesktopLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.isActive(pathname);
  return (
    <Button
      component={Link}
      to={item.to}
      variant={active ? "light" : "subtle"}
      color={active ? undefined : "gray"}
      size="sm"
      leftSection={<item.icon size={16} aria-hidden />}
      aria-current={active ? "page" : undefined}
    >
      {item.label}
    </Button>
  );
}

function CartButton() {
  const { itemCount } = useCart();
  const label = itemCount === 1 ? "Cart, 1 item" : `Cart, ${itemCount} items`;
  return (
    <Button
      component={Link}
      to="/cart"
      variant="light"
      leftSection={<IconShoppingCart size={18} aria-hidden />}
      rightSection={
        itemCount > 0 ? (
          <Badge size="sm" circle={itemCount < 10} variant="filled" aria-hidden>
            {itemCount > 99 ? "99+" : itemCount}
          </Badge>
        ) : undefined
      }
      aria-label={label}
    >
      Cart
    </Button>
  );
}

function MobileSection({
  title,
  items,
  pathname,
  onNavigate,
}: {
  title: string;
  items: readonly NavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <Stack gap={2}>
      <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" pb={4}>
        {title}
      </Text>
      {items.map((item) => (
        <NavLink
          key={item.to}
          component={Link}
          to={item.to}
          label={item.label}
          leftSection={<item.icon size={18} aria-hidden />}
          active={item.isActive(pathname)}
          aria-current={item.isActive(pathname) ? "page" : undefined}
          onClick={onNavigate}
        />
      ))}
    </Stack>
  );
}

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure(false);
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: 260, breakpoint: "md", collapsed: { desktop: true, mobile: !opened } }}
      padding="md"
    >
      <a href="#main-content" className={classes.skipLink}>
        Skip to content
      </a>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="md"
              size="sm"
              aria-label={opened ? "Close navigation" : "Open navigation"}
            />
            <Brand />
            <Group gap={4} visibleFrom="md" component="nav" aria-label="Main" ml="lg" wrap="nowrap">
              {SHOP_NAV.map((item) => (
                <DesktopLink key={item.to} item={item} pathname={pathname} />
              ))}
              <Divider orientation="vertical" mx="xs" />
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" mr={4}>
                Admin
              </Text>
              {ADMIN_NAV.map((item) => (
                <DesktopLink key={item.to} item={item} pathname={pathname} />
              ))}
            </Group>
          </Group>
          <CartButton />
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md" component="nav" aria-label="Main">
        <Stack gap="lg">
          <MobileSection title="Shop" items={SHOP_NAV} pathname={pathname} onNavigate={close} />
          <MobileSection title="Admin" items={ADMIN_NAV} pathname={pathname} onNavigate={close} />
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main id="main-content" tabIndex={-1}>
        <Container size="xl" px={0} pb="xl">
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<LoadingState />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}

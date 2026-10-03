import { Button } from "@mantine/core";
import { IconMapOff } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";

export default function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        icon={<IconMapOff size={30} stroke={1.5} />}
        title="We couldn't find that page"
        description="The link may be broken or the page may have moved."
        action={
          <Button component={Link} to="/">
            Back to the shop
          </Button>
        }
      />
    </>
  );
}

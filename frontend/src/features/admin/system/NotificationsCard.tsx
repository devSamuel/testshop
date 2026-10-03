import { Anchor, Badge, Table, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import { QueryState } from "../../../components/QueryState";
import { formatDateTime, humanize } from "../../../lib/format";
import { SectionCard } from "./SectionCard";
import { NOTIFICATIONS_LIMIT, useNotificationsLog } from "./useSystemQueries";

export function NotificationsCard() {
  const log = useNotificationsLog();
  return (
    <SectionCard
      id="recent-notifications"
      title="Recent notifications"
      description={`Customer emails produced by order events (latest ${NOTIFICATIONS_LIMIT}).`}
    >
      <QueryState
        query={log}
        errorTitle="Could not load notifications"
        isEmpty={(data) => data.length === 0}
        empty={
          <Text size="sm" c="dimmed">
            No notifications have been sent yet.
          </Text>
        }
      >
        {(data) => (
          <Table.ScrollContainer minWidth={600}>
            <Table verticalSpacing="xs" aria-label="Recent notifications">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Sent</Table.Th>
                  <Table.Th>Kind</Table.Th>
                  <Table.Th>Recipient</Table.Th>
                  <Table.Th>Subject</Table.Th>
                  <Table.Th>Order</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.map((notification) => (
                  <Table.Tr key={notification.id}>
                    <Table.Td>
                      <Text size="sm">{formatDateTime(notification.created_at)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color="indigo">
                        {humanize(notification.kind)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" truncate maw={200}>
                        {notification.recipient}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" lineClamp={1}>
                        {notification.subject}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Anchor component={Link} to={`/orders/${notification.order_id}`} size="sm">
                        #{notification.order_id}
                      </Anchor>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </QueryState>
    </SectionCard>
  );
}

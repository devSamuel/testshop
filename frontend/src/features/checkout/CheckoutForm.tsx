import { Button, Group, NativeSelect, Stack, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  IconBrandMastercard,
  IconBrandVisa,
  IconCreditCard,
  IconLock,
  IconMail,
} from "@tabler/icons-react";
import {
  cardBrand,
  currentYear,
  expiryYears,
  formatCardNumber,
  type TestCard,
} from "../../lib/card";
import { TestCardPicker } from "./TestCardPicker";
import {
  EMPTY_CHECKOUT_FORM,
  validateCheckout,
  type CheckoutFormErrors,
  type CheckoutFormValues,
} from "./validation";

const MONTH_OPTIONS = [
  { value: "", label: "MM", disabled: true },
  ...Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1),
    label: String(index + 1).padStart(2, "0"),
  })),
];

function yearOptions() {
  return [
    { value: "", label: "YYYY", disabled: true },
    ...expiryYears().map((year) => ({ value: String(year), label: String(year) })),
  ];
}

function BrandIcon({ number }: { number: string }) {
  const brand = cardBrand(number);
  if (brand === "visa") return <IconBrandVisa size={18} aria-hidden />;
  if (brand === "mastercard") return <IconBrandMastercard size={18} aria-hidden />;
  return <IconCreditCard size={18} aria-hidden />;
}

interface CheckoutFormProps {
  onSubmit: (values: CheckoutFormValues) => Promise<CheckoutFormErrors | undefined>;
  busy: boolean;
  disabled?: boolean;
  submitLabel: string;
}

export function CheckoutForm({ onSubmit, busy, disabled = false, submitLabel }: CheckoutFormProps) {
  const form = useForm<CheckoutFormValues>({
    mode: "controlled",
    initialValues: EMPTY_CHECKOUT_FORM,
    validate: (values) => validateCheckout(values),
  });

  const submitValues = async (values: CheckoutFormValues) => {
    const errors = await onSubmit(values);
    if (errors && Object.keys(errors).length > 0) form.setErrors(errors);
  };

  const applyTestCard = (card: TestCard) => {
    const current = form.getValues();
    form.setValues({
      cardNumber: formatCardNumber(card.number),
      expMonth: current.expMonth || "12",
      expYear: current.expYear || String(currentYear() + 2),
      cvc: current.cvc || "123",
    });
    form.clearErrors();
  };

  const cardInput = form.getInputProps("cardNumber");
  const locked = busy || disabled;

  return (
    <form
      noValidate
      aria-label="Checkout"
      onSubmit={form.onSubmit((values) => {
        void submitValues(values);
      })}
    >
      <Stack gap="md">
        <TextInput
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          leftSection={<IconMail size={16} aria-hidden />}
          withAsterisk
          disabled={busy}
          {...form.getInputProps("email")}
        />
        <TextInput
          label="Card number"
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="1234 1234 1234 1234"
          leftSection={<BrandIcon number={form.values.cardNumber} />}
          withAsterisk
          disabled={busy}
          {...cardInput}
          onChange={(event) =>
            form.setFieldValue("cardNumber", formatCardNumber(event.currentTarget.value))
          }
        />
        <TestCardPicker onPick={applyTestCard} disabled={busy} />
        <Group grow align="flex-start" gap="sm">
          <NativeSelect
            label="Exp. month"
            data={MONTH_OPTIONS}
            autoComplete="cc-exp-month"
            withAsterisk
            disabled={busy}
            {...form.getInputProps("expMonth")}
          />
          <NativeSelect
            label="Exp. year"
            data={yearOptions()}
            autoComplete="cc-exp-year"
            withAsterisk
            disabled={busy}
            {...form.getInputProps("expYear")}
          />
          <TextInput
            label="CVC"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="123"
            maxLength={4}
            withAsterisk
            disabled={busy}
            {...form.getInputProps("cvc")}
            onChange={(event) =>
              form.setFieldValue("cvc", event.currentTarget.value.replace(/\D/g, "").slice(0, 4))
            }
          />
        </Group>
        <Button
          type="submit"
          size="md"
          fullWidth
          loading={busy}
          disabled={locked}
          leftSection={<IconLock size={16} aria-hidden />}
        >
          {submitLabel}
        </Button>
        <Text size="xs" c="dimmed" ta="center">
          Each checkout attempt carries an idempotency key, so retries never charge you twice.
        </Text>
      </Stack>
    </form>
  );
}

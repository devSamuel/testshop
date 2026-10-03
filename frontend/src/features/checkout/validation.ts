import type { CheckoutRequest } from "../../api/types";
import { digitsOnly, isExpired, isLuhnValid } from "../../lib/card";
import type { CartLine } from "../cart/cartReducer";

export interface CheckoutFormValues {
  email: string;
  cardNumber: string;
  expMonth: string;
  expYear: string;
  cvc: string;
}

export type CheckoutField = keyof CheckoutFormValues;

export type CheckoutFormErrors = Partial<Record<CheckoutField, string>>;

export const EMPTY_CHECKOUT_FORM: CheckoutFormValues = {
  email: "",
  cardNumber: "",
  expMonth: "",
  expYear: "",
  cvc: "",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CVC_PATTERN = /^\d{3,4}$/;
const MAX_EMAIL_LENGTH = 320;

function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (!email) return "Email is required";
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return "Enter a valid email address";
  }
  return undefined;
}

function validateCardNumber(value: string): string | undefined {
  if (!digitsOnly(value)) return "Card number is required";
  return isLuhnValid(value) ? undefined : "Card number is invalid";
}

export function validateCheckout(
  values: CheckoutFormValues,
  now: Date = new Date(),
): CheckoutFormErrors {
  const errors: CheckoutFormErrors = {};
  const email = validateEmail(values.email);
  if (email) errors.email = email;
  const cardNumber = validateCardNumber(values.cardNumber);
  if (cardNumber) errors.cardNumber = cardNumber;

  const month = Number(values.expMonth);
  const year = Number(values.expYear);
  if (!values.expMonth) errors.expMonth = "Required";
  else if (!Number.isInteger(month) || month < 1 || month > 12) errors.expMonth = "Invalid month";
  if (!values.expYear) errors.expYear = "Required";
  else if (!Number.isInteger(year) || year < 2000 || year > 2100) errors.expYear = "Invalid year";
  if (!errors.expMonth && !errors.expYear && isExpired(month, year, now)) {
    errors.expMonth = "Card has expired";
  }

  if (!values.cvc) errors.cvc = "Required";
  else if (!CVC_PATTERN.test(values.cvc)) errors.cvc = "3 or 4 digits";
  return errors;
}

export function buildCheckoutRequest(
  values: CheckoutFormValues,
  lines: readonly CartLine[],
): CheckoutRequest {
  return {
    email: values.email.trim(),
    items: lines
      .map((line) => ({ product_id: line.productId, quantity: line.quantity }))
      .sort((left, right) => left.product_id - right.product_id),
    card: {
      number: digitsOnly(values.cardNumber),
      exp_month: Number(values.expMonth),
      exp_year: Number(values.expYear),
      cvc: values.cvc,
    },
  };
}

export function checkoutFingerprint(request: CheckoutRequest): string {
  return JSON.stringify({
    email: request.email.toLowerCase(),
    items: request.items,
    card: request.card.number,
  });
}

const SERVER_FIELDS: Readonly<Record<string, CheckoutField>> = {
  email: "email",
  "card.number": "cardNumber",
  "card.exp_month": "expMonth",
  "card.exp_year": "expYear",
  "card.cvc": "cvc",
};

export interface MappedServerErrors {
  formErrors: CheckoutFormErrors;
  otherMessages: string[];
}

export function mapServerErrors(fieldErrors: Readonly<Record<string, string>>): MappedServerErrors {
  const formErrors: CheckoutFormErrors = {};
  const otherMessages: string[] = [];
  for (const [field, message] of Object.entries(fieldErrors)) {
    const target =
      SERVER_FIELDS[field] ??
      (field === "card" ? (/expired/i.test(message) ? "expMonth" : "cardNumber") : undefined);
    if (target) formErrors[target] ??= message;
    else otherMessages.push(`${field}: ${message}`);
  }
  return { formErrors, otherMessages };
}

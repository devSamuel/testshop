export type CardBrand = "visa" | "mastercard" | "amex" | "card";

export interface TestCard {
  label: string;
  number: string;
  description: string;
  color: string;
}

export const TEST_CARDS: readonly TestCard[] = [
  {
    label: "Approve",
    number: "4242424242424242",
    description: "Payment succeeds immediately",
    color: "green",
  },
  {
    label: "Decline",
    number: "4000000000000002",
    description: "Payment is declined by the issuer",
    color: "red",
  },
  {
    label: "Slow approval",
    number: "4000000000000101",
    description: "Approves after ~6s; the order confirms asynchronously",
    color: "yellow",
  },
];

export const MIN_CARD_DIGITS = 12;
export const MAX_CARD_DIGITS = 19;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatCardNumber(value: string): string {
  const digits = digitsOnly(value).slice(0, MAX_CARD_DIGITS);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function isLuhnValid(value: string): boolean {
  const digits = digitsOnly(value);
  if (digits !== value.replace(/[\s-]/g, "")) return false;
  if (digits.length < MIN_CARD_DIGITS || digits.length > MAX_CARD_DIGITS) return false;
  let total = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
  }
  return total % 10 === 0;
}

export function isExpired(month: number, year: number, now: Date = new Date()): boolean {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  return year < currentYear || (year === currentYear && month < currentMonth);
}

export function cardBrand(value: string): CardBrand {
  const digits = digitsOnly(value);
  if (digits.startsWith("4")) return "visa";
  const firstTwo = digits.slice(0, 2);
  const firstFour = digits.slice(0, 4);
  if (["51", "52", "53", "54", "55"].includes(firstTwo)) return "mastercard";
  if (firstFour.length === 4 && firstFour >= "2221" && firstFour <= "2720") return "mastercard";
  if (firstTwo === "34" || firstTwo === "37") return "amex";
  return "card";
}

export function expiryYears(now: Date = new Date(), span = 12): number[] {
  const start = now.getFullYear();
  return Array.from({ length: span }, (_, offset) => start + offset);
}

export function currentYear(): number {
  return new Date().getFullYear();
}

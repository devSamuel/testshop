export type Cents = number;

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;
const formatters = new Map<string, Intl.NumberFormat>();

export class InvalidAmountError extends Error {
  override readonly name = "InvalidAmountError";

  constructor(value: string) {
    super(`"${value}" is not a valid amount`);
  }
}

export function parseScaled(value: string, scale: number): number | null {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, sign = "", whole = "", fraction = ""] = match;
  if (fraction.length > scale) return null;
  const magnitude = Number(whole + fraction.padEnd(scale, "0"));
  if (!Number.isSafeInteger(magnitude)) return null;
  return sign === "-" && magnitude !== 0 ? -magnitude : magnitude;
}

export function formatScaled(units: number, scale: number): string {
  if (!Number.isSafeInteger(units)) throw new RangeError(`${units} is not a safe integer`);
  const digits = Math.abs(units)
    .toString()
    .padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  const sign = units < 0 ? "-" : "";
  return scale === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

export function tryParseCents(value: string): Cents | null {
  return parseScaled(value, 2);
}

export function parseCents(value: string): Cents {
  const cents = tryParseCents(value);
  if (cents === null) throw new InvalidAmountError(value);
  return cents;
}

export function centsToDecimal(cents: Cents): string {
  return formatScaled(cents, 2);
}

export function multiplyCents(cents: Cents, quantity: number): Cents {
  if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(quantity)) {
    throw new RangeError("Money can only be multiplied by whole quantities");
  }
  const product = cents * quantity;
  if (!Number.isSafeInteger(product)) throw new RangeError("Amount is too large");
  return product;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) throw new RangeError("Amount is too large");
  }
  return total;
}

function formatterFor(currency: string): Intl.NumberFormat {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
    formatters.set(currency, formatter);
  }
  return formatter;
}

export function formatCents(cents: Cents, currency = "USD"): string {
  return formatterFor(currency).format(centsToDecimal(cents) as `${number}`);
}

export function formatMoney(value: string, currency = "USD"): string {
  const cents = tryParseCents(value);
  return cents === null ? value : formatCents(cents, currency);
}

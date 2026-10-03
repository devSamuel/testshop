import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { CheckoutForm } from "./CheckoutForm";

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  renderWithProviders(<CheckoutForm onSubmit={onSubmit} busy={false} submitLabel="Pay $10.00" />);
  return onSubmit;
}

describe("CheckoutForm", () => {
  it("fills the card number when a test card chip is clicked", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /use test card decline/i }));

    expect(screen.getByLabelText(/card number/i)).toHaveValue("4000 0000 0000 0002");
    expect(screen.getByLabelText(/cvc/i)).toHaveValue("123");
    expect(screen.getByLabelText(/exp\. month/i)).toHaveValue("12");
  });

  it("formats typed card numbers in groups of four", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/card number/i), "4242424242424242");
    expect(screen.getByLabelText(/card number/i)).toHaveValue("4242 4242 4242 4242");
  });

  it("blocks submission and explains invalid fields", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.type(screen.getByLabelText(/card number/i), "4242424242424241");
    await user.click(screen.getByRole("button", { name: /pay/i }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Card number is invalid")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits valid values and shows server-side field errors", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm(
      vi.fn().mockResolvedValue({ email: "Email domain is not allowed" }),
    );
    await user.type(screen.getByLabelText(/email/i), "buyer@example.com");
    await user.click(screen.getByRole("button", { name: /use test card approve/i }));
    await user.click(screen.getByRole("button", { name: /pay/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      email: "buyer@example.com",
      cardNumber: "4242 4242 4242 4242",
      cvc: "123",
    });
    expect(await screen.findByText("Email domain is not allowed")).toBeInTheDocument();
  });
});

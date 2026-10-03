import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, problemResponse } from "../test/render";
import {
  ApiError,
  apiFetch,
  apiRequest,
  buildUrl,
  parseErrorResponse,
  problemSlug,
} from "./client";

function stubFetch(...responses: (Response | Error | DOMException)[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Response) fetchMock.mockResolvedValueOnce(response);
    else fetchMock.mockRejectedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseErrorResponse", () => {
  it("parses RFC 7807 problem details with field errors", async () => {
    const response = jsonResponse(
      {
        type: "https://errors.shop.local/validation-error",
        title: "Request validation failed",
        status: 422,
        detail: "One or more fields are invalid",
        instance: "/api/products",
        errors: [
          { field: "price", message: "Input should be greater than or equal to 0" },
          { field: "card", message: "Value error, Card number is invalid" },
          { field: "price", message: "duplicate" },
        ],
      },
      { status: 422, headers: { "Content-Type": "application/problem+json" } },
    );

    const error = await parseErrorResponse(response);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.message).toBe("One or more fields are invalid");
    expect(error.problemType).toBe("validation-error");
    expect(error.fieldErrors).toEqual({
      price: "Input should be greater than or equal to 0",
      card: "Card number is invalid",
    });
    expect(error.isRetryable).toBe(false);
  });

  it("keeps problem extensions such as current_version", async () => {
    const error = await parseErrorResponse(
      problemResponse(409, "stale-version", { current_version: 4 }),
    );
    expect(error.is("stale-version")).toBe(true);
    expect(error.problem?.current_version).toBe(4);
  });

  it("handles non-JSON error bodies", async () => {
    const error = await parseErrorResponse(
      new Response("Bad gateway", { status: 502, headers: { "Content-Type": "text/plain" } }),
    );
    expect(error.problem).toBeNull();
    expect(error.body).toBe("Bad gateway");
    expect(error.isRetryable).toBe(true);
    expect(error.message).toContain("502");
  });

  it("keeps plain JSON bodies that are not problems", async () => {
    const error = await parseErrorResponse(jsonResponse({ run_id: "abc" }, { status: 422 }));
    expect(error.problem).toBeNull();
    expect(error.body).toEqual({ run_id: "abc" });
  });
});

describe("apiRequest", () => {
  it("serialises query parameters and skips empty ones", () => {
    expect(
      buildUrl("/api/products", {
        q: "mouse",
        category: "",
        page: 2,
        in_stock: true,
        x: undefined,
      }),
    ).toBe("/api/products?q=mouse&page=2&in_stock=true");
  });

  it("sends JSON bodies and custom headers", async () => {
    const fetchMock = stubFetch(jsonResponse({ id: 1 }, { status: 201 }));
    const response = await apiRequest<{ id: number }>("/api/orders", {
      method: "POST",
      json: { a: 1 },
      headers: { "Idempotency-Key": "key-123456" },
    });
    expect(response).toMatchObject({ status: 201, data: { id: 1 } });
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe("key-123456");
    expect(init?.body).toBe('{"a":1}');
  });

  it("returns undefined for 204 responses", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(apiFetch("/api/products/1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("converts network failures into retryable ApiErrors", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const error = await apiFetch("/api/products").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isNetworkError).toBe(true);
    expect((error as ApiError).isRetryable).toBe(true);
  });

  it("rethrows aborts untouched", async () => {
    stubFetch(new DOMException("aborted", "AbortError"));
    await expect(apiFetch("/api/products")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects HTML served in place of JSON", async () => {
    stubFetch(
      new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    await expect(apiFetch("/api/products")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("problemSlug", () => {
  it("extracts the last segment of the problem type", () => {
    expect(problemSlug("https://errors.shop.local/insufficient-stock")).toBe("insufficient-stock");
    expect(problemSlug("about:blank")).toBe("about:blank");
  });
});

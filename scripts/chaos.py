import argparse
import asyncio
import os
import random
import subprocess
import sys
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
APPROVE, DECLINE, SLOW = "4242424242424242", "4000000000000002", "4000000000000101"
CHAOS_ENV = {"RESERVATION_TTL_SECONDS": "15", "RECONCILE_AFTER_SECONDS": "3", "SWEEPER_INTERVAL_SECONDS": "1"}


@dataclass
class Buyer:
    index: int
    card: str
    key: str = field(default_factory=lambda: f"chaos-{uuid.uuid4()}")
    attempts: int = 0
    connection_errors: int = 0
    status_code: int | None = None
    order_id: int | None = None


def compose(*args: str, env: dict[str, str] | None = None) -> None:
    subprocess.run(
        ["docker", "compose", *args],
        cwd=ROOT,
        env={**os.environ, **(env or {})},
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


async def wait_ready(http: httpx.AsyncClient, limit_seconds: float = 120) -> None:
    deadline = time.monotonic() + limit_seconds
    while time.monotonic() < deadline:
        try:
            if (await http.get("/readyz")).status_code == 200:
                return
        except httpx.TransportError:
            pass
        await asyncio.sleep(0.5)
    raise SystemExit("app did not become ready")


async def buy(http: httpx.AsyncClient, buyer: Buyer, product_id: int) -> None:
    body = {
        "email": f"chaos{buyer.index}@example.com",
        "items": [{"product_id": product_id, "quantity": 1}],
        "card": {"number": buyer.card, "exp_month": 12, "exp_year": 2035, "cvc": "123"},
    }
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        buyer.attempts += 1
        try:
            response = await http.post("/api/orders", json=body, headers={"Idempotency-Key": buyer.key})
        except httpx.TransportError:
            buyer.connection_errors += 1
            await asyncio.sleep(0.5 + random.random())
            continue
        if response.status_code >= 500:
            await asyncio.sleep(0.5)
            continue
        buyer.status_code = response.status_code
        payload: dict[str, Any] = response.json()
        order = payload.get("order", payload)
        buyer.order_id = order.get("id") if isinstance(order, dict) else None
        return


async def kill_and_restart(http: httpx.AsyncClient, delay: float) -> float:
    await asyncio.sleep(delay)
    started = time.monotonic()
    await asyncio.to_thread(compose, "kill", "-s", "SIGKILL", "app", env=CHAOS_ENV)
    print(f"  !! app container SIGKILLed at t+{delay:.1f}s")
    await asyncio.to_thread(compose, "up", "-d", "app", env=CHAOS_ENV)
    await wait_ready(http)
    downtime = time.monotonic() - started
    print(f"  .. app back after {downtime:.1f}s")
    return downtime


async def orders_for(http: httpx.AsyncClient, product_id: int) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    page = 1
    while True:
        data = (await http.get("/api/orders", params={"page": page, "page_size": 100})).json()
        found += [o for o in data["items"] if any(i["product_id"] == product_id for i in o["items"])]
        if page * 100 >= data["total"]:
            return found
        page += 1


async def run(args: argparse.Namespace) -> int:
    print(
        f"Chaos test: {args.buyers} buyers race for {args.stock} units while the app is killed mid-checkout"
    )
    print("  .. restarting app with short reservation TTL for the experiment")
    compose("up", "-d", "--wait", env=CHAOS_ENV)
    rng = random.Random(args.seed)
    async with httpx.AsyncClient(base_url=args.base_url, timeout=30) as http:
        await wait_ready(http)
        sku = f"CHAOS-{int(time.time())}"
        product = (
            await http.post(
                "/api/products",
                json={
                    "sku": sku,
                    "name": "Chaos Monkey Plush",
                    "category": "Chaos",
                    "price": "10.00",
                    "stock": args.stock,
                },
            )
        ).json()
        product_id = product["id"]
        buyers = [
            Buyer(i, rng.choices([APPROVE, DECLINE, SLOW], weights=[6, 2, 2])[0]) for i in range(args.buyers)
        ]
        started = time.monotonic()
        killer = asyncio.create_task(kill_and_restart(http, args.kill_after))
        await asyncio.gather(*(buy(http, b, product_id) for b in buyers))
        downtime = await killer

        print("  .. waiting for the reconciler to settle pending orders")
        deadline = time.monotonic() + 90
        orders: list[dict[str, Any]] = []
        while time.monotonic() < deadline:
            orders = await orders_for(http, product_id)
            if not any(o["status"] == "pending_payment" for o in orders):
                break
            await asyncio.sleep(1)
        elapsed = time.monotonic() - started

        remaining = (await http.get(f"/api/products/{product_id}")).json()["stock"]
        invariants = (await http.get("/api/admin/invariants")).json()

    statuses = Counter(o["status"] for o in orders)
    sold = sum(i["quantity"] for o in orders if o["status"] == "paid" for i in o["items"])
    seen_ids = {b.order_id for b in buyers if b.order_id is not None}
    codes = Counter(b.status_code for b in buyers)
    retried = sum(1 for b in buyers if b.connection_errors)

    checks = [
        (
            "units sold + remaining stock == initial stock",
            sold + remaining == args.stock,
            f"{sold} + {remaining} = {args.stock}",
        ),
        ("no overselling", sold <= args.stock, f"sold {sold} of {args.stock}"),
        (
            "every buyer got exactly one definitive answer",
            all(b.status_code for b in buyers),
            f"{len(buyers)} buyers",
        ),
        (
            "no duplicate or orphan orders after retries",
            len(orders) == len(seen_ids),
            f"{len(orders)} orders, {len(seen_ids)} seen by clients",
        ),
        ("no order left pending", statuses.get("pending_payment", 0) == 0, dict(statuses)),
        (
            "all data-integrity invariants hold",
            invariants["passed"],
            f"{sum(c['passed'] for c in invariants['checks'])}/{len(invariants['checks'])} checks",
        ),
    ]

    print()
    print("| Metric | Value |")
    print("|---|---|")
    print(f"| Buyers / units | {args.buyers} / {args.stock} |")
    print(f"| App downtime (SIGKILL → ready) | {downtime:.1f}s |")
    print(f"| Buyers that hit a dropped connection and retried with the same key | {retried} |")
    print(f"| Final HTTP codes | {dict(sorted(codes.items(), key=lambda kv: kv[0] or 0))} |")
    print(f"| Orders by final status | {dict(statuses)} |")
    print(f"| Total time until settled | {elapsed:.1f}s |")
    print()
    print("| Check | Result | Detail |")
    print("|---|---|---|")
    for name, ok, detail in checks:
        print(f"| {name} | {'PASS' if ok else 'FAIL'} | {detail} |")
    for check in invariants["checks"]:
        if not check["passed"]:
            print(f"   violation in {check['name']}: {check['violations'][:3]}")

    if not args.keep_chaos_config:
        print("\n  .. restoring normal configuration")
        compose("up", "-d")
    passed = all(ok for _, ok, _ in checks)
    print(f"\nCHAOS RESULT: {'PASS' if passed else 'FAIL'}")
    return 0 if passed else 1


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Kill the app mid-checkout and verify nothing is lost or oversold"
    )
    parser.add_argument("--base-url", default=f"http://localhost:{os.environ.get('APP_PORT', '8080')}")
    parser.add_argument("--buyers", type=int, default=50)
    parser.add_argument("--stock", type=int, default=5)
    parser.add_argument("--kill-after", type=float, default=0.3)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--keep-chaos-config", action="store_true")
    sys.exit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()

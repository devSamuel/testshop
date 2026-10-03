import argparse
import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]


def compose(*args: str) -> str:
    result = subprocess.run(
        ["docker", "compose", *args], cwd=ROOT, check=True, capture_output=True, text=True
    )
    return result.stdout


def docker_cpus() -> str:
    result = subprocess.run(
        ["docker", "info", "--format", "{{.NCPU}}"], check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


async def outbox(http: httpx.AsyncClient) -> tuple[int, int]:
    data = (await http.get("/api/admin/outbox")).json()
    return data["pending"], data["published"]


async def scale_workers(replicas: int) -> None:
    await asyncio.to_thread(compose, "up", "-d", "--no-deps", "--scale", f"worker={replicas}", "worker")


async def build_backlog(http: httpx.AsyncClient, count: int, seed: int, idle_check: float) -> int:
    await asyncio.to_thread(compose, "stop", "worker")
    await asyncio.to_thread(
        compose,
        "exec",
        "-T",
        "app",
        "python",
        "-m",
        "app.cli",
        "seed-large",
        "--count",
        str(count),
        "--seed",
        str(seed),
    )
    pending, published = await outbox(http)
    await asyncio.sleep(idle_check)
    if (await outbox(http))[1] != published:
        raise SystemExit(
            "events were delivered while every worker container was stopped; "
            "another worker is running outside compose (make dev-worker?). Stop it and retry."
        )
    return pending


async def measure(
    http: httpx.AsyncClient, args: argparse.Namespace, replicas: int, seed: int
) -> dict[str, Any]:
    print(f"  .. {replicas} worker container(s): building a backlog with every worker stopped")
    backlog = await build_backlog(http, args.count, seed, args.idle_check)
    print(f"     {backlog:,} events pending; starting {replicas} worker container(s)")
    _, base = await outbox(http)
    await scale_workers(replicas)
    while True:
        if (await outbox(http))[1] != base:
            break
        await asyncio.sleep(0.05)
    started = time.monotonic()
    _, first = await outbox(http)
    while True:
        pending, published = await outbox(http)
        if pending == 0:
            break
        await asyncio.sleep(args.interval)
    seconds = time.monotonic() - started
    delivered = published - first
    rate = delivered / seconds
    print(f"     drained {delivered:,} events in {seconds:.1f}s ({rate:,.0f} events/s)")
    return {
        "replicas": replicas,
        "backlog": backlog,
        "delivered": delivered,
        "seconds": seconds,
        "rate": rate,
    }


async def run(args: argparse.Namespace) -> int:
    cpus = await asyncio.to_thread(docker_cpus)
    print(f"Outbox drain benchmark: backlog of {args.count:,} products per run, Docker CPUs: {cpus}")
    results: list[dict[str, Any]] = []
    async with httpx.AsyncClient(base_url=args.base_url, timeout=120) as http:
        try:
            for index, replicas in enumerate(args.replicas):
                results.append(await measure(http, args, replicas, int(time.time()) + index))
        finally:
            await scale_workers(args.restore)
        invariants = (await http.get("/api/admin/invariants")).json()

    baseline = results[0]["rate"]
    print()
    print(f"Docker CPUs: {cpus}. Each worker container runs {args.dispatchers} dispatcher tasks")
    print("on a single event loop, so one container uses at most one CPU core.")
    print()
    print("| Worker containers | Events delivered | Seconds | Events/s | vs. 1 container |")
    print("|---:|---:|---:|---:|---:|")
    for result in results:
        print(
            f"| {result['replicas']} | {result['delivered']:,} | {result['seconds']:.1f} | "
            f"{result['rate']:,.0f} | {result['rate'] / baseline:.1f}x |"
        )
    print()
    print(f"Invariants after the run: {'all passed' if invariants['passed'] else 'FAILED'}")
    return 0 if invariants["passed"] else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Outbox drain rate by number of worker containers")
    parser.add_argument("--base-url", default=f"http://localhost:{os.environ.get('APP_PORT', '8080')}")
    parser.add_argument("--count", type=int, default=50_000)
    parser.add_argument("--replicas", type=int, nargs="+", default=[1, 2, 4])
    parser.add_argument("--restore", type=int, default=1)
    parser.add_argument("--dispatchers", type=int, default=int(os.environ.get("DISPATCHER_WORKERS", "4")))
    parser.add_argument("--interval", type=float, default=0.25)
    parser.add_argument("--idle-check", type=float, default=2.0)
    sys.exit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()

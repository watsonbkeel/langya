#!/usr/bin/env python3
"""异步美术素材 Agent：提交、轮询并及时下载 og-image2-low 结果。

密钥只从 BKEEL_IMAGE_API_KEY 环境变量读取，绝不写入 manifest、日志或仓库。
每个 manifest 项对应一张图片；默认并发 5，超过 100 张必须显式确认。
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urljoin

try:
    import certifi
except ImportError:  # pragma: no cover - Debian 可直接使用系统证书
    certifi = None

DEFAULT_BASE_URL = "https://token.bkeel.com/v1"
DEFAULT_MODEL = "og-image2-low"
MAX_BATCH = 100
MAX_CONCURRENCY = 5
POLL_INTERVAL_SEC = 8
POLL_TIMEOUT_SEC = 20 * 60
SSL_CONTEXT = (
    ssl.create_default_context(cafile=certifi.where())
    if certifi is not None
    else ssl.create_default_context()
)


def request_json(
    url: str,
    method: str,
    payload: dict[str, Any] | None,
    api_key: str,
) -> dict[str, Any]:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    with urlopen(request, timeout=60, context=SSL_CONTEXT) as response:
        return json.loads(response.read().decode("utf-8"))


def download(url: str, destination: Path, api_key: str) -> None:
    request = Request(url, headers={"Authorization": f"Bearer {api_key}"})
    with urlopen(request, timeout=90, context=SSL_CONTEXT) as response:
        data = response.read()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)


def submit(item: dict[str, Any], base_url: str, model: str, api_key: str) -> str:
    response = request_json(
        f"{base_url}/images/generations",
        "POST",
        {
            "model": model,
            "prompt": item["prompt"],
        },
        api_key,
    )
    task_id = response.get("task_id")
    if not isinstance(task_id, str) or not task_id:
        raise RuntimeError("图片接口没有返回 task_id")
    return task_id


def run_item(
    item: dict[str, Any],
    base_url: str,
    model: str,
    api_key: str,
    output_dir: Path,
) -> tuple[str, str]:
    name = item.get("name")
    if not isinstance(name, str) or not name:
        raise ValueError("manifest 项缺少 name")
    task_id = submit(item, base_url, model, api_key)
    print(f"[image-agent] submitted {name} ({task_id})", flush=True)
    deadline = time.monotonic() + POLL_TIMEOUT_SEC
    while time.monotonic() < deadline:
        status = request_json(
            f"{base_url}/async-images/{task_id}",
            "GET",
            None,
            api_key,
        )
        state = status.get("status")
        if state == "succeeded":
            download_url = status.get("download_url") or status.get("image_url")
            if not isinstance(download_url, str) or not download_url:
                raise RuntimeError(f"{name} 成功但没有下载地址")
            download_url = urljoin(f"{base_url}/", download_url)
            destination = output_dir / f"{name}.png"
            download(download_url, destination, api_key)
            print(f"[image-agent] downloaded {name} -> {destination}", flush=True)
            return name, str(destination)
        if state in {"failed", "cancelled", "canceled"}:
            raise RuntimeError(f"{name} 生成失败：{status.get('error') or state}")
        time.sleep(POLL_INTERVAL_SEC)
    raise TimeoutError(f"{name} 超过轮询时限")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path, help="JSON 数组或 JSONL 素材任务")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-concurrency", type=int, default=MAX_CONCURRENCY)
    parser.add_argument(
        "--allow-over-100",
        action="store_true",
        help="仅在用户明确确认超过 100 张后使用",
    )
    args = parser.parse_args()
    api_key = os.environ.get("BKEEL_IMAGE_API_KEY")
    if not api_key:
        raise SystemExit("请设置 BKEEL_IMAGE_API_KEY（不会写入文件）")
    if args.max_concurrency < 1 or args.max_concurrency > MAX_CONCURRENCY:
        raise SystemExit(f"并发数必须在 1..{MAX_CONCURRENCY} 之间")

    raw = args.manifest.read_text(encoding="utf-8")
    if args.manifest.suffix.lower() == ".jsonl":
        items = [json.loads(line) for line in raw.splitlines() if line.strip()]
    else:
        items = json.loads(raw)
    if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
        raise SystemExit("manifest 必须是 JSON 对象数组或 JSONL")
    if len(items) > MAX_BATCH and not args.allow_over_100:
        raise SystemExit("本批超过 100 张，先向 watson 确认后再使用 --allow-over-100")
    if not items:
        raise SystemExit("manifest 为空")

    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=args.max_concurrency) as pool:
        futures = {
            pool.submit(
                run_item,
                item,
                args.base_url.rstrip("/"),
                args.model,
                api_key,
                args.output_dir,
            ): item.get("name", "<unnamed>")
            for item in items
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                future.result()
            except (HTTPError, URLError, OSError, RuntimeError, TimeoutError, ValueError) as error:
                failures.append(f"{name}: {error}")
                print(f"[image-agent] failed {name}: {error}", file=sys.stderr, flush=True)

    if failures:
        print(f"[image-agent] 完成但有 {len(failures)} 个失败", file=sys.stderr)
        return 1
    print(f"[image-agent] 全部完成：{len(items)} 张")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env bash
# castrel-chaos.sh — Castrel Chaos CLI
# Usage: ./scripts/castrel-chaos.sh <command> [subcommand] [options]
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED=$'\e[0;31m'; GREEN=$'\e[0;32m'; YELLOW=$'\e[1;33m'
CYAN=$'\e[0;36m'; BOLD=$'\e[1m'; NC=$'\e[0m'

# ── Service port map ──────────────────────────────────────────────────────────
HOST="${CASTREL_HOST:-localhost}"

port_of() {
  case "$1" in
    gateway)     echo 18080 ;;
    user)        echo 18081 ;;
    catalog)     echo 18082 ;;
    inventory)   echo 18083 ;;
    order)       echo 18084 ;;
    payment)     echo 18085 ;;
    runner)      echo 18086 ;;
    promotion)   echo 18087 ;;
    risk)        echo 18088 ;;
    fulfillment) echo 18089 ;;
    notification) echo 18090 ;;
    *) echo "" ;;
  esac
}

base_url() {
  local svc="$1"
  local p; p=$(port_of "$svc")
  [[ -z "$p" ]] && { echo -e "${RED}Unknown service: $svc${NC}" >&2; exit 1; }
  echo "http://$HOST:$p"
}

# ── HTTP helpers ──────────────────────────────────────────────────────────────
do_get() {
  echo -e "${CYAN}GET $1${NC}"
  curl -sf "$1" | python3 -m json.tool 2>/dev/null || curl -s "$1"
  echo
}

do_post() {
  local url="$1"; shift
  local body="${1:-}"
  if [[ -n "$body" ]]; then
    echo -e "${CYAN}POST $url${NC} $body"
    curl -sf -X POST "$url" -H "Content-Type: application/json" -d "$body" \
      | python3 -m json.tool 2>/dev/null || curl -s -X POST "$url" -H "Content-Type: application/json" -d "$body"
  else
    echo -e "${CYAN}POST $url${NC}"
    curl -sf -X POST "$url" | python3 -m json.tool 2>/dev/null || curl -s -X POST "$url"
  fi
  echo
}

do_put() {
  local url="$1"; body="$2"
  echo -e "${CYAN}PUT $url${NC} $body"
  curl -sf -X PUT "$url" -H "Content-Type: application/json" -d "$body" \
    | python3 -m json.tool 2>/dev/null || curl -s -X PUT "$url" -H "Content-Type: application/json" -d "$body"
  echo
}

# ── Help ──────────────────────────────────────────────────────────────────────
show_help() {
  cat <<EOF
${BOLD}Castrel Chaos CLI${NC}

${BOLD}USAGE${NC}
  castrel-chaos.sh <command> [subcommand] [flags]

${BOLD}ENVIRONMENT${NC}
  CASTREL_HOST   Target host (default: localhost)

${BOLD}COMMANDS${NC}

  ${YELLOW}runner${NC}
    status                        查看 runner 运行状态
    pause                         暂停流量
    resume                        恢复流量
    rate <multiplier>             设置流量倍率 (e.g. 2.0)
    config                        查看 runner 配置
    config-update <version> [key=val ...]  更新配置 (version 为乐观锁)
    reset-trigger                 手动触发库存重置

  ${YELLOW}inventory${NC}
    status <sku>                  查询 SKU 库存
    reset-plan                    查看重置计划 (dry-run)
    reset <expectedVersion>       执行库存重置

  ${YELLOW}slow-sql${NC}
    enable <service> [flags]      启用慢 SQL
      --mode      sleep|delay     (default: sleep)
      --delay     <ms>            延迟毫秒数 (default: 2000)
      --rate      <0.0-1.0>       注入概率 (default: 1.0)
      --duration  <sec>           自动关闭秒数, 0=永不 (default: 60)
    disable <service>             禁用慢 SQL
    status  <service>             查看状态 (order/payment 支持)

    <service>: catalog | inventory | order | payment | promotion | risk | fulfillment

  ${YELLOW}memory-leak${NC}
    start  <service> [flags]      启动内存泄漏
      --chunk     <kb>            每次分配块大小 (default: 1024)
      --interval  <ms>            分配间隔 (default: 500)
      --max       <mb>            最大占用上限 (default: 512)
    stop   <service>              停止 (保留已占内存)
    clear  <service>              清除已泄漏内存
    status <service>              查看状态

    <service>: order | payment

  ${YELLOW}deadlock${NC}
    enable  <service> [flags]     启用死锁注入
      --rate      <0.0-1.0>       触发概率 (default: 0.3)
      --duration  <sec>           自动关闭秒数, 0=永不 (default: 60)
    disable <service>             禁用死锁注入
    clear   <service>             清除计数器
    status  <service>             查看状态

    <service>: order | payment

${BOLD}EXAMPLES${NC}
  ./scripts/castrel-chaos.sh runner status
  ./scripts/castrel-chaos.sh runner rate 2.0
  ./scripts/castrel-chaos.sh inventory reset-plan
  ./scripts/castrel-chaos.sh inventory reset 1
  ./scripts/castrel-chaos.sh slow-sql enable order --delay 3000 --rate 0.5 --duration 60
  ./scripts/castrel-chaos.sh slow-sql disable order
  ./scripts/castrel-chaos.sh slow-sql status order
  ./scripts/castrel-chaos.sh memory-leak start order --chunk 1024 --max 512
  ./scripts/castrel-chaos.sh memory-leak clear order
  ./scripts/castrel-chaos.sh deadlock enable payment --rate 0.3 --duration 120
  ./scripts/castrel-chaos.sh deadlock status payment
EOF
}

# ── runner ────────────────────────────────────────────────────────────────────
cmd_runner() {
  local sub="${1:-help}"; shift || true
  local base; base=$(base_url runner)
  case "$sub" in
    status)         do_get  "$base/internal/runner/status" ;;
    pause)          do_post "$base/internal/runner/pause" ;;
    resume)         do_post "$base/internal/runner/resume" ;;
    rate)
      local mult="${1:?Usage: runner rate <multiplier>}"
      do_post "$base/internal/runner/rate" "{\"multiplier\": $mult}"
      ;;
    config)         do_get  "$base/internal/runner/config" ;;
    config-update)
      local ver="${1:?Usage: runner config-update <version> [key=val ...]}"
      shift
      local body="{\"version\": $ver"
      for kv in "$@"; do
        local k="${kv%%=*}" v="${kv#*=}"
        # wrap non-numeric values in quotes
        if [[ "$v" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
          body+=", \"$k\": $v"
        else
          body+=", \"$k\": \"$v\""
        fi
      done
      body+="}"
      do_put "$base/internal/runner/config" "$body"
      ;;
    reset-trigger)  do_post "$base/internal/runner/inventory-reset/trigger" ;;
    *)
      echo -e "${RED}Unknown runner subcommand: $sub${NC}"
      echo "  subcommands: status | pause | resume | rate | config | config-update | reset-trigger"
      exit 1
      ;;
  esac
}

# ── inventory ─────────────────────────────────────────────────────────────────
cmd_inventory() {
  local sub="${1:-help}"; shift || true
  local base; base=$(base_url inventory)
  case "$sub" in
    status)
      local sku="${1:?Usage: inventory status <sku>}"
      do_get "$base/internal/inventory/$sku"
      ;;
    reset-plan)  do_post "$base/internal/inventory/reset/plan" ;;
    reset)
      local ver="${1:?Usage: inventory reset <expectedVersion>}"
      do_post "$base/internal/inventory/reset" "{\"expectedVersion\": $ver}"
      ;;
    *)
      echo -e "${RED}Unknown inventory subcommand: $sub${NC}"
      echo "  subcommands: status | reset-plan | reset"
      exit 1
      ;;
  esac
}

# ── slow-sql ──────────────────────────────────────────────────────────────────
cmd_slow_sql() {
  local sub="${1:-help}"; shift || true
  case "$sub" in
    enable)
      local svc="${1:?Usage: slow-sql enable <service> [--mode sleep] [--delay 2000] [--rate 1.0] [--duration 60]}"
      shift
      local mode="sleep" delay=2000 rate="1.0" duration=60
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --mode)     mode="$2";     shift 2 ;;
          --delay)    delay="$2";    shift 2 ;;
          --rate)     rate="$2";     shift 2 ;;
          --duration) duration="$2"; shift 2 ;;
          *) echo -e "${RED}Unknown flag: $1${NC}"; exit 1 ;;
        esac
      done
      local base; base=$(base_url "$svc")
      do_post "$base/internal/chaos/slow-sql/enable" \
        "{\"mode\": \"$mode\", \"delayMs\": $delay, \"injectRate\": $rate, \"durationSec\": $duration}"
      ;;
    disable)
      local svc="${1:?Usage: slow-sql disable <service>}"
      local base; base=$(base_url "$svc")
      do_post "$base/internal/chaos/slow-sql/disable"
      ;;
    status)
      local svc="${1:?Usage: slow-sql status <service>}"
      local base; base=$(base_url "$svc")
      do_get "$base/internal/chaos/slow-sql/status"
      ;;
    *)
      echo -e "${RED}Unknown slow-sql subcommand: $sub${NC}"
      echo "  subcommands: enable | disable | status"
      exit 1
      ;;
  esac
}

# ── memory-leak ───────────────────────────────────────────────────────────────
cmd_memory_leak() {
  local sub="${1:-help}"; shift || true
  case "$sub" in
    start)
      local svc="${1:?Usage: memory-leak start <service> [--chunk 1024] [--interval 500] [--max 512]}"
      shift
      local chunk=1024 interval=500 max=512
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --chunk)    chunk="$2";    shift 2 ;;
          --interval) interval="$2"; shift 2 ;;
          --max)      max="$2";      shift 2 ;;
          *) echo -e "${RED}Unknown flag: $1${NC}"; exit 1 ;;
        esac
      done
      local base; base=$(base_url "$svc")
      do_post "$base/internal/chaos/memory-leak/start" \
        "{\"chunkSizeKb\": $chunk, \"intervalMs\": $interval, \"maxMb\": $max}"
      ;;
    stop)
      local svc="${1:?Usage: memory-leak stop <service>}"
      local base; base=$(base_url "$svc")
      do_post "$base/internal/chaos/memory-leak/stop"
      ;;
    clear)
      local svc="${1:?Usage: memory-leak clear <service>}"
      local base; base=$(base_url "$svc")
      do_post "$base/internal/chaos/memory-leak/clear"
      ;;
    status)
      local svc="${1:?Usage: memory-leak status <service>}"
      local base; base=$(base_url "$svc")
      do_get "$base/internal/chaos/memory-leak/status"
      ;;
    *)
      echo -e "${RED}Unknown memory-leak subcommand: $sub${NC}"
      echo "  subcommands: start | stop | clear | status"
      exit 1
      ;;
  esac
}

# ── deadlock ──────────────────────────────────────────────────────────────────
cmd_deadlock() {
  local sub="${1:-help}"; shift || true
  case "$sub" in
    enable)
      local svc="${1:?Usage: deadlock enable <service> [--rate 0.3] [--duration 60]}"
      shift
      local rate="0.3" duration=60
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --rate)     rate="$2";     shift 2 ;;
          --duration) duration="$2"; shift 2 ;;
          *) echo -e "${RED}Unknown flag: $1${NC}"; exit 1 ;;
        esac
      done
      local base; base=$(base_url "$svc")
      do_post "$base/internal/chaos/deadlock/enable" \
        "{\"injectRate\": $rate, \"durationSec\": $duration}"
      ;;
    disable)
      local svc="${1:?Usage: deadlock disable <service>}"
      local base; base=$(base_url "$svc")
      do_post "$base/internal/chaos/deadlock/disable"
      ;;
    clear)
      local svc="${1:?Usage: deadlock clear <service>}"
      local base; base=$(base_url "$svc")
      do_post "$base/internal/chaos/deadlock/clear"
      ;;
    status)
      local svc="${1:?Usage: deadlock status <service>}"
      local base; base=$(base_url "$svc")
      do_get "$base/internal/chaos/deadlock/status"
      ;;
    *)
      echo -e "${RED}Unknown deadlock subcommand: $sub${NC}"
      echo "  subcommands: enable | disable | clear | status"
      exit 1
      ;;
  esac
}

# ── Main dispatch ─────────────────────────────────────────────────────────────
CMD="${1:-help}"; [[ $# -gt 0 ]] && shift || true

case "$CMD" in
  runner)       cmd_runner       "$@" ;;
  inventory)    cmd_inventory    "$@" ;;
  slow-sql)     cmd_slow_sql     "$@" ;;
  memory-leak)  cmd_memory_leak  "$@" ;;
  deadlock)     cmd_deadlock     "$@" ;;
  help|--help|-h) show_help ;;
  *)
    echo -e "${RED}Unknown command: $CMD${NC}"
    echo ""
    show_help
    exit 1
    ;;
esac

---
name: chaos-status
description: Show the current chaos injection status across all 8 Castrel business services (slow-sql, memory-leak, deadlock, table-lock). Outputs a compact table with enabled/disabled state for each service.
disable-model-invocation: true
---

# Chaos Status

查询全部 8 个业务服务的当前 chaos 注入状态，输出汇总视图。

## 用法

```
/chaos-status
```

无参数，直接执行。

## 执行脚本

```bash
#!/usr/bin/env bash
# 查询全部服务当前 chaos 状态（通过 traffic-control-plane 汇总接口）
BASE="http://localhost:13086/internal/traffic/chaos"
SERVICES=(catalog-service inventory-service order-service payment-service promotion-service risk-service fulfillment-service notification-service)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "%-22s %-10s %-20s %-10s %-12s\n" "SERVICE" "SLOW-SQL" "MEMORY-LEAK(MB)" "DEADLOCK" "TABLE-LOCK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for svc in "${SERVICES[@]}"; do
  # slow-sql
  ss=$(curl -sf "${BASE}/slow-sql/status?targets=${svc}" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  results=d.get('data',{}).get('results',[d.get('data',{})])
  r=results[0] if results else {}
  print('ON' if r.get('enabled') else 'off')
except: print('?')
" 2>/dev/null)

  # memory-leak
  ml=$(curl -sf "${BASE}/memory-leak/status?targets=${svc}" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  results=d.get('data',{}).get('results',[d.get('data',{})])
  r=results[0] if results else {}
  if r.get('enabled'):
    mb=r.get('holdingMb',r.get('holding_mb',0))
    print(f'ON({mb}MB)')
  else:
    print('off')
except: print('?')
" 2>/dev/null)

  # deadlock
  dl=$(curl -sf "${BASE}/deadlock/status?targets=${svc}" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  results=d.get('data',{}).get('results',[d.get('data',{})])
  r=results[0] if results else {}
  if r.get('enabled'):
    rate=r.get('injectRate',r.get('inject_rate',''))
    print(f'ON({rate})')
  else:
    print('off')
except: print('?')
" 2>/dev/null)

  # table-lock
  tl=$(curl -sf "${BASE}/table-lock/status?targets=${svc}" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  results=d.get('data',{}).get('results',[d.get('data',{})])
  r=results[0] if results else {}
  print('ON' if r.get('active',r.get('enabled')) else 'off')
except: print('?')
" 2>/dev/null)

  printf "%-22s %-10s %-20s %-10s %-12s\n" "$svc" "$ss" "$ml" "$dl" "$tl"
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 网络故障状态
echo ""
echo "Network Proxies:"
for proxy in order-to-payment order-to-inventory gateway-to-order; do
  status=$(curl -sf "${BASE}/network-delay/status?proxyName=${proxy}" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  r=d.get('data',{})
  toxics=r.get('toxics',[])
  if toxics:
    t=toxics[0]
    lat=t.get('attributes',{}).get('latency',0)
    print(f'  DELAY {lat}ms')
  else:
    print('  clean')
except: print('  ?')
" 2>/dev/null)
  printf "  %-25s %s\n" "$proxy" "$status"
done
```

上面的脚本可以直接在终端运行，或者让 Claude 帮你执行并解读输出。

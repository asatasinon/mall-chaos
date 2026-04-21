#!/bin/sh
set -eu

service_name="${OTEL_SERVICE_NAME:-${CW_APP_NAME:-java-service}}"
dump_dir="${JAVA_DUMP_DIR:-/service-data/heapdumps}"

mkdir -p "$dump_dir"
rm -f "$dump_dir"/*.hprof

timestamp="$(date +%Y%m%d-%H%M%S)"
dump_path="$dump_dir/${service_name}-${timestamp}.hprof"

if [ -n "${JAVA_TOOL_OPTIONS:-}" ]; then
  export JAVA_TOOL_OPTIONS="$JAVA_TOOL_OPTIONS -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=$dump_path"
else
  export JAVA_TOOL_OPTIONS="-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=$dump_path"
fi

exec java -jar app.jar
#!/bin/sh
set -eu

service_name="${OTEL_SERVICE_NAME:-${CW_APP_NAME:-java-service}}"
dump_dir="${JAVA_DUMP_DIR:-/service-data/heapdumps}"

mkdir -p "$dump_dir"
rm -f "$dump_dir"/*.hprof

timestamp="$(date +%Y%m%d-%H%M%S)"
dump_path="$dump_dir/${service_name}-${timestamp}.hprof"

append_java_tool_option() {
  option="$1"
  case " ${JAVA_TOOL_OPTIONS:-} " in
    *" $option "*)
      return
      ;;
  esac

  if [ -n "${JAVA_TOOL_OPTIONS:-}" ]; then
    export JAVA_TOOL_OPTIONS="$JAVA_TOOL_OPTIONS $option"
  else
    export JAVA_TOOL_OPTIONS="$option"
  fi
}

append_java_tool_option "-XX:+HeapDumpOnOutOfMemoryError"
append_java_tool_option "-XX:+ExitOnOutOfMemoryError"
append_java_tool_option "-XX:HeapDumpPath=$dump_path"

exec java -jar app.jar

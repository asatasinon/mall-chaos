#!/bin/sh
set -eu

service_name="${OTEL_SERVICE_NAME:-${CW_APP_NAME:-java-service}}"
dump_dir="${JAVA_DUMP_DIR:-/service-data/heapdumps}"

mkdir -p "$dump_dir"

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

enable_skywalking_optional_plugin() {
  pattern="$1"
  optional_dir="/app/skywalking-agent/optional-plugins"
  plugins_dir="/app/skywalking-agent/plugins"

  [ -d "$optional_dir" ] || return
  [ -d "$plugins_dir" ] || return

  for jar in "$optional_dir"/$pattern; do
    [ -f "$jar" ] || continue
    target="$plugins_dir/$(basename "$jar")"
    [ -f "$target" ] || cp "$jar" "$target"
  done
}

if [ -n "${JAVA_OPTS:-}" ] && [ -z "${JAVA_TOOL_OPTIONS:-}" ]; then
  export JAVA_TOOL_OPTIONS="$JAVA_OPTS"
fi

case "${ENABLE_CLOUDWISE_AGENT:-false}" in
  1|true|TRUE|yes|YES|on|ON)
    append_java_tool_option "-javaagent:/data/app/JavaAgent/lib/agent.jar=/data/app/JavaAgent"
    ;;
esac

# TRACING_MODE controls OTel vs SkyWalking agent selection:
#   otel-only (default) - OTel agent only, respects ENABLE_OTEL_AGENT
#   sw-only             - SkyWalking agent only, forces ENABLE_OTEL_AGENT=false
#   both                - both agents active simultaneously
tracing_mode="${TRACING_MODE:-otel-only}"

case "$tracing_mode" in
  sw-only)
    ENABLE_OTEL_AGENT=false
    ;;
esac

case "${ENABLE_OTEL_AGENT:-true}" in
  1|true|TRUE|yes|YES|on|ON)
    append_java_tool_option "-javaagent:/app/opentelemetry-javaagent.jar"
    ;;
esac

case "$tracing_mode" in
  sw-only|both)
    enable_skywalking_optional_plugin "apm-spring-webflux-6.x-plugin-*.jar"
    enable_skywalking_optional_plugin "apm-spring-cloud-gateway-4.x-plugin-*.jar"
    enable_skywalking_optional_plugin "apm-springmvc-annotation-6.x-plugin-*.jar"
    enable_skywalking_optional_plugin "apm-resttemplate-6.x-plugin-*.jar"
    append_java_tool_option "-javaagent:/app/skywalking-agent/skywalking-agent.jar"
    ;;
esac

append_java_tool_option "-Dfile.encoding=UTF-8"
append_java_tool_option "-Dsun.jnu.encoding=UTF-8"
append_java_tool_option "-Djava.security.egd=file:/dev/./urandom"
append_java_tool_option "-XX:+UseContainerSupport"
append_java_tool_option "-XX:+UseG1GC"
append_java_tool_option "-XX:+UseStringDeduplication"
append_java_tool_option "-XX:+ParallelRefProcEnabled"
append_java_tool_option "-XX:MaxGCPauseMillis=${JAVA_MAX_GC_PAUSE_MILLIS:-200}"
append_java_tool_option "-XX:InitialRAMPercentage=${JAVA_INITIAL_RAM_PERCENTAGE:-25.0}"
append_java_tool_option "-XX:MinRAMPercentage=${JAVA_MIN_RAM_PERCENTAGE:-25.0}"
append_java_tool_option "-XX:MaxRAMPercentage=${JAVA_MAX_RAM_PERCENTAGE:-75.0}"
append_java_tool_option "-XX:+HeapDumpOnOutOfMemoryError"
append_java_tool_option "-XX:+ExitOnOutOfMemoryError"
append_java_tool_option "-XX:HeapDumpPath=$dump_path"

exec java -jar app.jar

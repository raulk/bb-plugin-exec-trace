# Transparent bash tracer (MVP). Sourced via BASH_ENV (bash) / ENV (sh).
# Uses set -x with BASH_XTRACEFD so every simple command is logged with a
# timestamp, without forking per command (EPOCHREALTIME/BASHPID are builtins).
# shellcheck disable=SC1090,SC2034

if [ -n "${BB_TRACE_ACTIVE_SH:-}" ]; then
  return 0 2>/dev/null || exit 0
fi
if [ -z "${BASH_VERSION:-}" ]; then
  export BB_TRACE_ACTIVE_SH=1
  if [ -n "${BB_TRACE_DIR:-}" ]; then
    mkdir -p "$BB_TRACE_DIR" 2>/dev/null
    export BB_TRACE_FILE="$BB_TRACE_DIR/bash-$$.ndjson"
    set -x
  fi
  return 0 2>/dev/null || exit 0
fi

export BB_TRACE_ACTIVE_SH=1
if [ -z "${BB_TRACE_DIR:-}" ]; then
  return 0 2>/dev/null || exit 0
fi

mkdir -p "$BB_TRACE_DIR" 2>/dev/null
export BB_TRACE_FILE="$BB_TRACE_DIR/bash-${BASHPID:-$$}.ndjson"

# NOTE: xtrace prints "$PS4-expanded + command". PS4 must NOT contain
# BASH_COMMAND or it duplicates/recurses. Keep PS4 to metadata only;
# bash appends the actual command text after it.
if exec {BB_TRACE_FD}>>"$BB_TRACE_FILE" 2>/dev/null; then
  export BASH_XTRACEFD=$BB_TRACE_FD
  export PS4='+TRACE ts=$EPOCHREALTIME pid=$BASHPID sub=$BASH_SUBSHELL thread=$BB_THREAD_ID :: '
  set -x
else
  export PS4='+TRACE pid=$BASHPID :: '
  set -x
fi

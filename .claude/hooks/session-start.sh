#!/bin/bash
# Put the pinned Node 24.15.0 (installed by the cloud environment setup script
# into /opt/node24) ahead of the system Node for every Bash call in the session.
if [ -x /opt/node24/bin/node ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH=/opt/node24/bin:$PATH' >> "$CLAUDE_ENV_FILE"
  echo 'export COREPACK_ENABLE_DOWNLOAD_PROMPT=0' >> "$CLAUDE_ENV_FILE"
fi
if [ ! -x /opt/node24/bin/node ]; then
  echo "Node 24.15.0 is not installed at /opt/node24. See CLAUDE.md > Environment." >&2
fi
exit 0

"""Preserved command for the original standalone, readonly HTML export."""
import sys
from platform_runtime.olive import load_snapshot

if __name__ == "__main__":
    load_snapshot().main()
else:
    sys.modules[__name__] = load_snapshot()

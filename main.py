"""JetBrains/CLI entry point; historical imports remain the exact legacy module."""
if __name__ == "__main__":
    from platform_runtime.launcher import run
    run()
else:
    import sys
    from platform_runtime.olive import load_legacy
    sys.modules[__name__] = load_legacy()
